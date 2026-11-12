const assert = require('node:assert/strict');
const http = require('node:http');
const {translateLibre} = require('../vscode-extension/libretranslate.cjs');
const {createTranslator} = require('../vscode-extension/translation.cjs');
(async () => {
 let count=0, received;
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  received=JSON.parse(body);count++;
  if(received.q==='error'){res.writeHead(503);res.end('{}');return;}
  if(received.q==='invalid'){res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({translatedText:'机器人具有两个自由度。'}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${server.address().port}/translate`;
 try {
  const values={provider:'libretranslate',libreEndpoint:endpoint};
  const vscode={workspace:{getConfiguration:()=>({get:(k,d)=>values[k]??d})}};
  const translator=createTranslator(vscode,__dirname,()=>{throw new Error('Must not launch Python');});
  const result=await translator({text:'The robot has two degrees of freedom.'});
  assert.equal(result.translation,'机器人具有两个自由度。');
  assert.equal(result.label,'局域网翻译');assert.equal(received.source,'en');assert.equal(received.target,'zh');
  assert.equal((await translator({text:'The robot has two degrees of freedom.'})).cached,true);assert.equal(count,1);
  values.libreSourceLanguage='auto';await translator({text:'The robot has two degrees of freedom.'});assert.equal(count,2);assert.equal(received.source,'auto');
  await assert.rejects(translateLibre({endpoint,text:'error',target:'zh-CN'}),/503/);
  await assert.rejects(translateLibre({endpoint,text:'invalid',target:'zh-CN'}),/有效译文/);
  await assert.rejects(translateLibre({endpoint:'file:///tmp/test',text:'test',target:'zh-CN'}),/HTTP/);
  console.log('PASS: real HTTP request, Chinese decoding, language mapping, cache/source isolation, no Python or key, HTTP and invalid response errors.');
 } finally { server.closeAllConnections();server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
