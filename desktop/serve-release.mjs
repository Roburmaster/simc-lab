// Serves a release folder like the R2 bucket does, for testing downloads and app updates locally:
// node serve-release.mjs [folder] [port], with a build made by SIMC_LAB_UPDATE_URL=http://127.0.0.1:8790/ SIMC_LAB_DIST=dist-test node build.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve(import.meta.dirname,process.argv[2]||'dist');const port=Number(process.argv[3]||8790);
const types={'.exe':'application/vnd.microsoft.portable-executable','.yml':'text/yaml','.blockmap':'application/octet-stream'};
http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,'');
  const file=path.join(dir,name);
  if(!name||name.includes('..')||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404).end('Not found');return;}
  console.log(`${new Date().toLocaleTimeString('en-GB')} ${req.method} /${name}`);
  const size=fs.statSync(file).size,range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
  if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):size-1;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);return;}
  res.writeHead(200,{...headers,'Content-Length':size,...(name.endsWith('.exe')?{'Content-Disposition':`attachment; filename="${name}"`}:{})});fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Serving ${dir} on http://127.0.0.1:${port}/`));
