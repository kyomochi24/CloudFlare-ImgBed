import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../frontend-dist/studio/workshop/',import.meta.url));
export async function serveWorkshop(){
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(!url.pathname.startsWith('/studio/workshop/')){res.writeHead(404).end();return;}
  try{
   let path=decodeURIComponent(url.pathname.slice('/studio/workshop/'.length));if(!path||path.endsWith('/'))path+='index.html';
   const file=resolve(root,path);if(!file.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.zip':'application/zip'}[extname(file)]||'application/octet-stream';
   const body=await readFile(file);res.writeHead(200,{'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}).end(body);
  }catch{res.writeHead(404).end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,url:'http://127.0.0.1:'+server.address().port+'/studio/workshop/'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const{url}=await serveWorkshop();console.log(url);}
