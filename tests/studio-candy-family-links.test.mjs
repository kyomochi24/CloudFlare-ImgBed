import assert from 'node:assert/strict';
import test from 'node:test';
import {imageLinks,replaceLinks} from '../frontend-dist/studio/theme-utils.js';
import {cssUrls} from '../frontend-dist/studio/css-utils.js';
import {inspectTheme,familyMatches,mapFamilyColor,exportTheme,migrateColorChanges} from '../frontend-dist/studio/candy-utils.js';

test('extracts extensionless top-bar and quoted GIF parentheses, excluding font URLs and comments',()=>{
 const css=`/* url("https://example.com/comment.png") */
 @font-face { src:url("https://example.com/font-without-extension"),url("https://example.com/font.ttf"); }
 #top-settings-holder::after { background-image:url('https://imgbed.heliar.top/i/mav3kzBfJ4xMPdLg'); }
 hr {background:url('https://imgbed.heliar.top/i/yBKVUH7DU5SwGefY_6d1b6216(1).gif') center/contain;}
 .x {border-image-source:url("https://example.com/边框(2).png?v=1");}
 `;
 assert.deepEqual(imageLinks(JSON.stringify({custom_css:css})),[
  'https://imgbed.heliar.top/i/mav3kzBfJ4xMPdLg','https://imgbed.heliar.top/i/yBKVUH7DU5SwGefY_6d1b6216(1).gif','https://example.com/边框(2).png?v=1']);
});

test('handles escaped parentheses and JSON-escaped slashes during extraction and replacement',()=>{
 const css=String.raw`.a{background:url(https://example.com/image\(1\).png);}`;
 const raw=JSON.stringify({custom_css:css,photo:'https://example.com/direct(2).png'}).replaceAll('/','\\/');
 assert.deepEqual(imageLinks(raw),['https://example.com/image(1).png','https://example.com/direct(2).png']);
 const output=JSON.parse(replaceLinks(raw,new Map([['https://example.com/image(1).png','https://new.example.com/a.png']])));
 assert.equal(output.custom_css,'.a{background:url(https://new.example.com/a.png);}');
 assert.equal(cssUrls('.x { content:"url(fake)"; background:url("https://example.com/a(1).png"); }').length,1);
});

test('color inspection ignores CSS selectors, comments, content strings and URL fragments',()=>{
 const raw=JSON.stringify({custom_css:'/* #ff0000 */ #face {color:#ff9ec8;background:url("https://example.com/a.png#abc");content:"#def";border:1px solid white;}'});
 const colors=inspectTheme(raw).colors;
 assert.deepEqual(colors.map(c=>[c.hex,c.scope]),[['#ff9ec8','text'],['#ffffff','style']]);
});

test('extensionless URLs replace exactly once without changing longer URLs or cascading',()=>{
 const a='https://example.com/image',b='https://example.com/image.png',c='https://new.example.com/green.png';
 const raw=JSON.stringify({photo:a,photo2:b,custom_css:`.x{background:url("${a}"),url("${b}");}`});
 const result=JSON.parse(replaceLinks(raw,new Map([[a,b],[b,c]])));
 assert.equal(result.photo,b);assert.equal(result.photo2,c);
 assert.equal(result.custom_css,`.x{background:url("${b}"),url("${c}");}`);
});

test('pink family changes text while black, white, gray and backgrounds stay untouched',()=>{
 const raw=JSON.stringify({main_text_color:'#000000',custom_css:'.x{color:#f3a6b8;background:#ff9ec8;} .y{color:rgba(229,143,166,.6);-webkit-text-stroke:1px white;} .z{color:#707070;}'});
 const colors=inspectTheme(raw).colors,options={range:30,scope:'text',protectNeutral:true};
 const targets=colors.filter(c=>familyMatches(c,'#ed8fb6',options));
 assert.equal(targets.length,2);
 const changes=new Map(targets.map(c=>[c.id,mapFamilyColor(c.hex,'#ed8fb6','#8abde8')]));
 const result=JSON.parse(exportTheme(raw,'蓝色版',new Map(),changes));
 assert.equal(result.main_text_color,'#000000');
 assert.match(result.custom_css,/background:#ff9ec8/);
 assert.match(result.custom_css,/-webkit-text-stroke:1px white/);
 assert.match(result.custom_css,/color:#707070/);
 assert.match(result.custom_css,/, \.6\)/);
 assert.ok(!result.custom_css.includes('color:#f3a6b8'));
 assert.equal(colors.filter(c=>familyMatches(c,'#ed8fb6',{...options,scope:'all'})).length,3);
});

test('old draft changes migrate by source location instead of shifting onto another color',()=>{
 const raw=JSON.stringify({custom_css:'/* #fff */ #face {color:#ff9ec8;border:1px solid white;}'});
 const legacy=inspectTheme(raw,{legacy:true}).colors;
 const pink=legacy.find(c=>c.hex==='#ff9ec8');
 const changes=migrateColorChanges(raw,{0:'#000000',[pink.id]:'#8abde8'});
 assert.deepEqual(changes,{0:'#8abde8'});
});
