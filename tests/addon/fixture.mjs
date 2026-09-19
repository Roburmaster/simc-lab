// A small but complete Upgrade Finder job, shaped like runs/<id>/job.json, for the Data.lua writer and the
// addon tests. Numbers are chosen so every ranking in the tests is unambiguous.
export const season={
  season:{id:37,name:'Midnight Season 2'},
  tracks:[
    {id:617,name:'Hero',levels:[1,2,3,4,5,6].map(n=>({level:n,max:6,bonusId:12829+n,itemLevel:276+3*n})),finalDrop:null},
    {id:618,name:'Myth',levels:[1,2,3,4,5,6].map(n=>({level:n,max:6,bonusId:12839+n,itemLevel:289+3*n})),finalDrop:{bonusId:13848,itemLevel:344}},
  ],
  difficulties:[{name:'Heroic',track:617},{name:'Mythic',track:618}],
  raids:[{id:1320,name:'The Venomous Abyss',encounters:[{id:2888,name:"Nek'zali the Soulcoiler",sequence:1},{id:2895,name:"Ula'tek",sequence:4},{id:-97,name:'Trash Drop',sequence:1}]}],
  dungeons:[{id:1322,name:'Altar of Fangs'},{id:1041,name:"Kings' Rest"}],
  delves:{id:-98,name:'Delves Season 2'},
};

export const profile=`# Temulan - Blood - 2026-09-19 16:28 - EU/Ravencrest
# SimC Addon 12.1.0-03
# WoW 12.1.0.69875, TOC 120100
deathknight="Temulan"
level=90
race=draenei
region=eu
server=ravencrest
role=tank
spec=blood
talents=CoPAkXBWxkyfx9CbGaHonEAhLx
head=,id=240001,enchant_id=8016,bonus_id=12831/6652
neck=,id=240002,gem_id=240908,bonus_id=12841
trinket1=,id=240003,bonus_id=12835
main_hand=,id=240004,enchant_id=7981,bonus_id=12840/42`;

export const talentData={find:info=>info.class==='deathknight'&&info.spec==='blood'?{specId:250}:null};

const candidate=(key,slot,itemId,name,bonus,itemLevel,sources)=>({key,slot,itemId,name,itemLevel,value:`,id=${itemId},bonus_id=${bonus}`,sources});
const raid=(enc,name,label)=>({origin:'raid',group:`raid:${enc}`,groupName:name,label});

export function upgradeJob({id='11111111-2222-3333-4444-555555555555',created='2026-09-19T14:30:55.869Z'}={}){
  return {
    id,mode:'upgrades',status:'complete',name:'Temulan',created,finished:'2026-09-19T14:40:00.000Z',
    engine:{version:'1210-01',wowVersion:'12.1.0.69875'},
    settings:{iterations:10000,targetError:0.1,duration:300,threads:8},
    scenarios:[{style:'Patchwerk',targets:1},{style:'Patchwerk',targets:5}],
    upgrade:{season:season.season,finalists:48,candidates:[
      candidate('c001','head',250001,"Ula'tek's Crown",'6652/12830',279,[raid(2895,"Ula'tek","Raid · Ula'tek · Heroic · Hero 1/6"),{origin:'vault',group:'vault:2895',groupName:"Ula'tek",label:"Great Vault · Raid · Ula'tek · Myth 1/6"}]),
      candidate('c002','trinket1',250002,'Fang of the Altar','12841',292,[{origin:'mplus',group:'mplus:1322',groupName:'Altar of Fangs',label:'Mythic+ · Altar of Fangs · Myth 1/6'}]),
      candidate('c003','neck',250003,'Coil Pendant','12830',279,[raid(2888,"Nek'zali the Soulcoiler","Raid · Nek'zali the Soulcoiler · Heroic · Hero 1/6")]),
      candidate('c004','trinket2',250002,'Fang of the Altar','12841',292,[{origin:'mplus',group:'mplus:1322',groupName:'Altar of Fangs',label:'Mythic+ · Altar of Fangs · Myth 1/6'}]),
      candidate('c005','feet',250005,'Delver Boots','12835',291,[{origin:'delves',group:'delves:-98',groupName:'Delves Season 2',label:'Delves · Hero 6/6'}]),
    ]},
    stages:[
      {scenario:0,stage:1,status:'complete',baseline:{dps:100000,error95:600}},
      {scenario:0,stage:2,status:'complete',baseline:{dps:100000,error95:100}},
      {scenario:1,stage:1,status:'complete',baseline:{dps:300000,error95:900}},
      {scenario:1,stage:2,status:'complete',baseline:{dps:300000,error95:300}},
    ],
    results:[
      {scenario:0,stage:1,key:'c001',dps:101900,error95:600,status:'complete'},
      {scenario:0,stage:1,key:'c002',dps:103100,error95:600,status:'complete'},
      {scenario:0,stage:1,key:'c003',dps:99000,error95:600,status:'complete'},
      {scenario:0,stage:1,key:'c004',dps:102900,error95:600,status:'complete'},
      {scenario:0,stage:1,key:'c005',dps:100800,error95:600,status:'complete'},
      {scenario:0,stage:2,key:'c001',dps:102000,error95:100,status:'complete'},
      {scenario:0,stage:2,key:'c002',dps:103000,error95:100,status:'complete'},
      {scenario:0,stage:2,key:'c004',dps:102800,error95:100,status:'complete'},
      {scenario:0,stage:2,key:'c003',dps:99500,error95:100,status:'complete'},
      {scenario:1,stage:2,key:'c001',dps:305700,error95:300,status:'complete'},
      {scenario:1,stage:2,key:'c002',dps:303000,error95:300,status:'complete'},
    ],
  };
}

export const request={profile,mode:'upgrades',upgrades:{raid:{enabled:true,difficulty:617}}};
