// services/chunkService.js

const {

GET_MULTIPLE_FIELDS,

GET_HASH_FIELD,

SET_HASH_FIELD,

SET_MULTIPLE_FIELDS

}=require(
"./redisService"
);

/*
--------------------------------
TIME HELPERS
--------------------------------
*/

function GET_HOUR_BUCKETS(

FROM,
TO

){

const BUCKETS=[];

const CURRENT=
new Date(
FROM
);

CURRENT.setUTCMinutes(
0,
0,
0
);

const END=
new Date(
TO
);

END.setUTCMinutes(
0,
0,
0
);

while(
CURRENT<=END
){

BUCKETS.push(
new Date(
CURRENT
));

CURRENT.setUTCHours(

CURRENT.getUTCHours()
+
1

);

}

return BUCKETS;

}

/*
--------------------------------
REDIS KEY HELPERS
--------------------------------
*/

function BUILD_CHUNK_KEY(
DATE
){

const Y=
DATE.getUTCFullYear();

const M=
String(
DATE.getUTCMonth()+1
).padStart(
2,
"0"
);

const D=
String(
DATE.getUTCDate()
).padStart(
2,
"0"
);

return `calls:${Y}-${M}-${D}`;

}

function BUILD_FIELD_NAME(

DATE,
DIRECTION

){

const H=
String(
DATE.getUTCHours()
).padStart(
2,
"0"
);

return `${H}_${DIRECTION}`;

}

/*
--------------------------------
GROUP BUCKETS BY REDIS HASH KEY

calls:2026-06-01

09_outbound
10_outbound
11_outbound

single HMGET
--------------------------------
*/

function GROUP_BUCKETS(

BUCKETS,
DIRECTION

){

const MAP=
new Map();

for(
const BUCKET
of BUCKETS
){

const KEY=
BUILD_CHUNK_KEY(
BUCKET
);

const FIELD=
BUILD_FIELD_NAME(

BUCKET,
DIRECTION

);

if(
!MAP.has(KEY)
){

MAP.set(
KEY,
[]
);

}

MAP.get(KEY)
.push(
FIELD
);

}

return MAP;

}

/*
--------------------------------
LOAD REDIS CHUNKS PARALLEL
--------------------------------
*/

async function LOAD_CHUNKS(

FROM,
TO,
DIRECTION

){

const BUCKETS=

GET_HOUR_BUCKETS(

FROM,
TO

);

const GROUPED=

GROUP_BUCKETS(

BUCKETS,
DIRECTION

);

const PROMISES=[];

for(
const [KEY,FIELDS]
of GROUPED
){

PROMISES.push(

GET_MULTIPLE_FIELDS(
KEY,
FIELDS
)

.then(
RESULT=>({

key:KEY,

fields:FIELDS,

result:RESULT

})
)

);

}

const HASH_RESULTS=

await Promise.all(
PROMISES
);

const OUTPUT=[];

for(
const HASH
of HASH_RESULTS
){

for(
let i=0;
i<HASH.fields.length;
i++
){

OUTPUT.push({

key:
HASH.key,

field:
HASH.fields[i],

data:
HASH.result[i]

});

}

}

return OUTPUT;

}

/*
--------------------------------
MERGE CHUNKS
--------------------------------
*/

function MERGE_CHUNKS(
CHUNKS
){

const ROWS=[];

for(
const CHUNK
of CHUNKS
){

if(

CHUNK?.data &&
Array.isArray(
CHUNK.data
)

){

ROWS.push(
...CHUNK.data
);

}

}

return ROWS;

}

/*
--------------------------------
FILTER EXACT RANGE

because chunk granularity
is hourly
--------------------------------
*/

function FILTER_BY_RANGE(

ROWS,

FROM,

TO

){

const FROM_MS=
new Date(
FROM
).getTime();

const TO_MS=
new Date(
TO
).getTime();

return ROWS.filter(
ROW=>{

const T=
Number(
ROW.call_start_time
);

return(

T>=FROM_MS &&

T<=TO_MS

);

}
);

}

/*
--------------------------------
MISSING CHUNKS

used later to fetch mongo
--------------------------------
*/

function FIND_MISSING_CHUNKS(
CHUNKS
){

return CHUNKS.filter(
X=>
!X.data
);

}

/*
--------------------------------
FETCH MISSING CHUNKS
FROM MONGO
--------------------------------
*/

async function POPULATE_MISSING_CHUNKS(

DB,

MISSING,

DIRECTION,

TTL=86400

){

if(
!MISSING.length
){

return;

}

const COL=

DB.collection(
"transcriptions"
);

const GROUPED=
new Map();

/*
group missing fields by day
*/

for(
const ITEM
of MISSING
){

if(
!GROUPED.has(
ITEM.key
)
){

GROUPED.set(

ITEM.key,

[]

);

}

GROUPED.get(
ITEM.key
).push(
ITEM.field
);

}

for(

const [KEY,FIELDS]

of GROUPED

){

const DATE_STR=

KEY.replace(
"calls:",
""
);

const [

Y,

M,

D

]=DATE_STR

.split(
"-"
)

.map(
Number
);

const DAY_START=

new Date(

Date.UTC(

Y,

M-1,

D,

0,

0,

0

)

);

const DAY_END=

new Date(

Date.UTC(

Y,

M-1,

D,

23,

59,

59,

999

)

);

console.log(

"[CACHE MISS]",

KEY,

FIELDS.length,

"fields"

);

const DOCS=

await COL.aggregate([

{

$match:{

"body.event":

"call_analyzed",

createdAt:{

$gte:
DAY_START,

$lte:
DAY_END

},

"body.call.direction":

DIRECTION

}

},

{

$addFields:{

phone_str:{

$cond:[

{

$eq:[

"$body.call.direction",

"inbound"

]

},

"$body.call.from_number",

"$body.call.to_number"

]

}

}

},

{

$addFields:{

phone:{

$convert:{

input:

"$phone_str",

to:

"long",

onError:null,

onNull:null

}

}

}

},

{

$lookup:{

from:

"realtimeleads",

localField:

"phone",

foreignField:

"phone",

as:

"matched"

}

},

{

$project:{

_id:0,

phone_number:
"$phone",

call_id:
"$body.call.call_id",

CombinedRetellCost:
"$body.call.call_cost.combined_cost",

disconnection_reason:
"$body.call.disconnection_reason",

call_duration_seconds:
"$body.call.call_cost.total_duration_seconds",

ToNumber:
"$body.call.to_number",

FromNumber:
"$body.call.from_number",

call_disposition:

"$body.call.call_analysis.custom_analysis_data.call_disposition",

call_direction:
"$body.call.direction",

call_start_time:
"$body.call.start_timestamp",

Lead_type:

{
$arrayElemAt:

[
"$matched.type",

0

]

},

Vendor:

{
$arrayElemAt:

[
"$matched.vendor",

0

]

},

LeadBoughtDate_est_dateonly:{

$cond:[

{

$ne:[

{

$arrayElemAt:[

"$matched.createdAt",

0

]

},

null

]

},

{

$dateToString:{

date:{

$arrayElemAt:[

"$matched.createdAt",

0

]

},

timezone:

"America/New_York",

format:

"%Y-%m-%d"

}

},

"(unknown)"

]

}

}

}

]).toArray();

/*
bucket docs by hour field
*/

const SAVE_MAP={};

for(
const FIELD
of FIELDS
){

SAVE_MAP[
FIELD
]=null;

}

for(
const DOC
of DOCS
){

const DATE=

new Date(

Number(
DOC.call_start_time
)

);

const FIELD=

BUILD_FIELD_NAME(

DATE,

DIRECTION

);

if(

SAVE_MAP[
FIELD
]===null

){

SAVE_MAP[
FIELD
]=[];

}

SAVE_MAP[
FIELD
].push(
DOC
);

}

}

const FILTERED_SAVE_MAP={};

for(
const [FIELD,ROWS]
of Object.entries(
SAVE_MAP
)
){

if(
Array.isArray(
ROWS
)
&&
ROWS.length>0
){

FILTERED_SAVE_MAP[
FIELD
]=ROWS;

}

}

if(

Object.keys(
FILTERED_SAVE_MAP
).length

){

await SET_MULTIPLE_FIELDS(

KEY,

FILTERED_SAVE_MAP,

TTL

);

}

}






module.exports={

GET_HOUR_BUCKETS,

BUILD_CHUNK_KEY,

BUILD_FIELD_NAME,

LOAD_CHUNKS,

MERGE_CHUNKS,

FILTER_BY_RANGE,

FIND_MISSING_CHUNKS,

POPULATE_MISSING_CHUNKS

};
