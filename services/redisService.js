// services/redisService.js

const redis = require("redis");

const REDIS_HOST =
process.env.REDIS_HOST || "localhost";

const REDIS_PORT =
parseInt(
process.env.REDIS_PORT || "6379",
10
);

const REDIS_CLIENT =
redis.createClient({

socket:{

host:
REDIS_HOST,

port:
REDIS_PORT

}

});

REDIS_CLIENT.on(
"error",
(err)=>{

console.error(
"Redis Error:",
err
);

}
);

REDIS_CLIENT.on(
"connect",
()=>{

console.log(
"✅ Redis Connected"
);

}
);

async function CONNECT_REDIS(){

if(
!REDIS_CLIENT.isOpen
){

await REDIS_CLIENT.connect();

}

}

/*
--------------------------------

GENERIC

--------------------------------
*/

async function GET_CACHE(KEY){

return await REDIS_CLIENT.get(
KEY
);

}

async function SET_CACHE(

KEY,

VALUE,

TTL

){

await REDIS_CLIENT.set(

KEY,

JSON.stringify(
VALUE
),

{

EX:TTL

}

);

}

async function GET_TTL(KEY){

return await REDIS_CLIENT.ttl(
KEY
);

}

/*
--------------------------------

HASH CHUNK HELPERS

--------------------------------
*/

async function GET_HASH_FIELD(

KEY,

FIELD

){

const DATA =

await REDIS_CLIENT.hGet(
KEY,
FIELD
);

if(!DATA){

return null;

}

return JSON.parse(
DATA
);

}

async function SET_HASH_FIELD(

KEY,

FIELD,

VALUE,

TTL

){

await REDIS_CLIENT.hSet(

KEY,

FIELD,

JSON.stringify(
VALUE
)

);

await REDIS_CLIENT.expire(

KEY,

TTL

);

}

async function GET_MULTIPLE_FIELDS(

KEY,

FIELDS

){

if(
!FIELDS.length
){

return [];

}

const VALUES =

await REDIS_CLIENT.hmGet(

KEY,

FIELDS

);

return VALUES.map(
x=>{

if(!x){

return null;

}

return JSON.parse(
x
);

}
);

}

module.exports={

CONNECT_REDIS,

GET_CACHE,

SET_CACHE,

GET_TTL,

GET_HASH_FIELD,

SET_HASH_FIELD,

GET_MULTIPLE_FIELDS

};