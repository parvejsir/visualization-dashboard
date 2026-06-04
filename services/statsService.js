// services/statsService.js

function EMPTY_MAP() {

    return new Map();

}

function INC(

    MAP,

    KEY,

    VALUE = 1

) {

    MAP.set(

        KEY,

        (MAP.get(KEY) || 0)

        +

        VALUE

    );

}

function MAP_TO_ARRAY(

    MAP,

    FIELD_NAME = "count"

) {

    return [...MAP.entries()]

        .map(
            ([KEY, VAL]) => ({

                key: KEY,

                [FIELD_NAME]: VAL

            })
        )

        .sort(
            (a, b) =>

                b[FIELD_NAME]

                -

                a[FIELD_NAME]

        );

}

/*
--------------------------------
FILTERS
--------------------------------
*/

function APPLY_FILTERS(

    ROWS,

    FILTERS

) {

    const {

        durationBucket,

        disconnectionReasons,

        callDispositions

    } = FILTERS;

    return ROWS.filter(
        ROW => {

            /*
            duration
            */

            const DUR =

                Number(
                    ROW.call_duration_seconds
                ) || 0;

            if (

                durationBucket === "gte3" &&
                DUR < 3

            ) return false;

            if (

                durationBucket === "gte10" &&
                DUR < 10

            ) return false;

            if (

                durationBucket === "gte30" &&
                DUR < 30

            ) return false;

            if (

                durationBucket === "gte60" &&
                DUR < 60

            ) return false;

            if (

                durationBucket === "gte120" &&
                DUR < 120

            ) return false;

            /*
            disconnect
            */

            if (

                disconnectionReasons.length &&

                !disconnectionReasons.includes(

                    ROW.disconnection_reason

                )

            ) {

                return false;

            }

            /*
            disposition
            */

            if (

                callDispositions.length &&

                !callDispositions.includes(

                    ROW.call_disposition

                )

            ) {

                return false;

            }

            return true;

        });

}

/*
--------------------------------
MAIN
--------------------------------
*/

function BUILD_STATS(

    RAW_ROWS,

    FILTERS = {}

) {

    const ROWS =

        APPLY_FILTERS(

            RAW_ROWS,

            FILTERS

        );

    const TOTAL =

        ROWS.length;

    const BY_DISPO =
        EMPTY_MAP();

    const BY_DISC =
        EMPTY_MAP();

    const BY_DIR =
        EMPTY_MAP();

    const BY_VENDOR =
        EMPTY_MAP();

    const BY_LEAD =
        EMPTY_MAP();

    const BUY_DATE =
        EMPTY_MAP();

    const COMBO =
        EMPTY_MAP();

    const UNIQUE =
        new Map();

    let G10 = 0;
    let G30 = 0;
    let G60 = 0;
    let G120 = 0;

    /*
    --------------------------------
    SCAN ONCE
    --------------------------------
    */

    for (
        const R
        of ROWS
    ) {

        const DUR =

            Number(
                R.call_duration_seconds
            ) || 0;

        const DISPO =

            R.call_disposition ||

            "(none)";

        const DISC =

            R.disconnection_reason ||

            "(none)";

        const DIR =

            R.call_direction ||

            "(unknown)";

        const LEAD =

            R.Lead_type ||

            "(no type)";

        const VENDOR =

            R.Vendor ||

            "(no vendor)";

        const DATE =

            R.LeadBoughtDate_est_dateonly ||

            "(unknown)";

        /*
        count maps
        */

        INC(
            BY_DISPO,
            DISPO
        );

        INC(
            BY_DISC,
            DISC
        );

        INC(
            BY_DIR,
            DIR
        );

        INC(
            BY_VENDOR,
            VENDOR
        );

        INC(
            BY_LEAD,
            LEAD
        );

        INC(
            BUY_DATE,
            DATE
        );

        INC(
            COMBO,
            `${LEAD}|||${DATE}`
        );

        /*
        duration
        */

        if (
            DUR >= 10
        ) G10++;

        if (
            DUR >= 30
        ) G30++;

        if (
            DUR >= 60
        ) G60++;

        if (
            DUR >= 120
        ) G120++;

        /*
        unique phone
        */

        const PHONE =

            String(
                R.phone_number || ""
            );

        if (
            PHONE
        ) {

            if (
                !UNIQUE.has(
                    PHONE
                )
            ) {

                UNIQUE.set(

                    PHONE,

                    {

                        count: 0,

                        vendor: VENDOR,

                        lead: LEAD,

                        date: DATE

                    }

                );

            }

            UNIQUE.get(
                PHONE
            ).count++;

        }

    }

    /*
    --------------------------------
    UNIQUE
    --------------------------------
    */

    let REDIAL2 = 0;
    let REDIAL3 = 0;
    let REDIAL5 = 0;
    let REDIAL10 = 0;

    const UNIQUE_VENDOR =
        EMPTY_MAP();

    const UNIQUE_LEAD =
        EMPTY_MAP();

    const UNIQUE_DATE =
        EMPTY_MAP();

    const HIST =
        EMPTY_MAP();

    for (
        const X
        of UNIQUE.values()
    ) {

        INC(
            UNIQUE_VENDOR,
            X.vendor
        );

        INC(
            UNIQUE_LEAD,
            X.lead
        );

        INC(
            UNIQUE_DATE,
            X.date
        );

        const C =
            X.count;

        if (
            C >= 2
        ) REDIAL2++;

        if (
            C >= 3
        ) REDIAL3++;

        if (
            C >= 5
        ) REDIAL5++;

        if (
            C >= 10
        ) REDIAL10++;

        const BUCKET =

            C === 1 ?

                "1 call"

                :

                C === 2 ?

                    "2 calls"

                    :

                    C === 3 ?

                        "3 calls"

                        :

                        C <= 9 ?

                            "4–9 calls"

                            :

                            "10+ calls";

        INC(
            HIST,
            BUCKET
        );

    }

    const UNIQUE_TOTAL =

        UNIQUE.size;

    return {

        totalCalls:
            TOTAL || 0,

        durationSummary:

        {

            total:
                TOTAL || 0,

            gte10:
                G10 || 0,

            gte30:
                G30 || 0,

            gte60:
                G60 || 0,

            gte120:
                G120 || 0,

            pctGte10:
                TOTAL ?
                    Math.round(
                        G10 * 1000 / TOTAL
                    ) / 10
                    : 0,

            pctGte30:
                TOTAL ?
                    Math.round(
                        G30 * 1000 / TOTAL
                    ) / 10
                    : 0,

            pctGte60:
                TOTAL ?
                    Math.round(
                        G60 * 1000 / TOTAL
                    ) / 10
                    : 0,

            pctGte120:
                TOTAL ?
                    Math.round(
                        G120 * 1000 / TOTAL
                    ) / 10
                    : 0

        },

        uniqueLeads:

        {

            total:
                UNIQUE_TOTAL || 0,

            avgDialsPerUnique:

                UNIQUE_TOTAL ?

                    Math.round(
                        TOTAL /
                        UNIQUE_TOTAL
                        * 100
                    ) / 100

                    : 0,

            redialAtLeast2:
                REDIAL2 || 0,

            redialAtLeast3:
                REDIAL3 || 0,

            redialAtLeast5:
                REDIAL5 || 0,

            redialAtLeast10:
                REDIAL10 || 0

        },

        byDisposition:

            MAP_TO_ARRAY(
                BY_DISPO
            ) || [],

        byDisconnectionReason:

            MAP_TO_ARRAY(
                BY_DISC
            ) || [],

        byDirection:

            MAP_TO_ARRAY(
                BY_DIR
            ) || [],

        byLeadType:

            MAP_TO_ARRAY(
                BY_LEAD
            ) || [],

        byVendor:

            MAP_TO_ARRAY(
                BY_VENDOR
            ) || [],

        byLeadBoughtDate:

            [...BUY_DATE.entries()]
                .map(([date, count]) => ({
                    date,
                    count
                })),

        leadTypeByBuyDate:

            [...COMBO.entries()]
                .map(([key, count]) => {

                    const [
                        lt,
                        date
                    ] = key.split("|||");

                    return {

                        leadType: lt,

                        buyDate: date,

                        count

                    };

                }),

        uniqueByVendor:

            MAP_TO_ARRAY(

                UNIQUE_VENDOR,

                "uniqueLeads"

            ) || [],

        uniqueByLeadType:

            MAP_TO_ARRAY(

                UNIQUE_LEAD,

                "uniqueLeads"

            ) || [],

        uniqueByLeadBoughtDate:

            [...UNIQUE_DATE.entries()]
                .map(([date, count]) => ({

                    date,

                    uniqueLeads: count

                })),

        dialCountHistogram:

            [...HIST.entries()]
                .map(([bucket, val]) => ({

                    bucket,

                    uniqueLeads: val

                }))

    };

}

module.exports = {

    BUILD_STATS,

    APPLY_FILTERS

};
