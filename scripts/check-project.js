const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const mini=path.join(root,'miniprogram');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()&&entry.name!=='node_modules'?walk(path.join(dir,entry.name)):entry.isFile()?[path.join(dir,entry.name)]:[]);}
const issues=[];
const all=walk(mini);let bytes=0;
for(const file of all){
 bytes+=fs.statSync(file).size;
 if(file.endsWith('.json'))try{JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){issues.push(path.relative(root,file)+': '+error.message);}
 if(file.endsWith('.js'))try{new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});}catch(error){issues.push(path.relative(root,file)+': '+error.message);}
 if(file.endsWith('.wxml')){
  const text=fs.readFileSync(file,'utf8');
  for(const match of text.matchAll(/wx:(if|elif|for)="([^"]*)"/g))if(!match[2].includes('{{'))issues.push(path.relative(root,file)+': wx:'+match[1]+' 缺少表达式插值');
  // Check the raw binding source, without the HTML entity decoding performed by
  // the browser preview. This is a syntax guard, not a substitute for WeChat WXML compilation.
  for(const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)){
   try{new vm.Script('('+match[1]+')',{filename:file});}
   catch(error){const line=text.slice(0,match.index).split('\n').length;issues.push(path.relative(root,file)+':'+line+': 模板表达式语法错误 '+match[0]+'；'+error.message);}
  }
  for(const match of text.matchAll(/src="(\/assets\/[^"]+)"/g))if(!fs.existsSync(path.join(mini,match[1])))issues.push('缺少图片 '+match[1]);
 }
}
const app=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8'));
for(const [scope,value] of Object.entries(app.permission||{}))if(typeof value.desc!=='string'||!value.desc.trim()||Array.from(value.desc).length>30)issues.push('权限 '+scope+' 的用途说明必须为1—30字');
const packages=app.subPackages||[];
const project=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
const ignored=project.packOptions&&project.packOptions.ignore||[];
function isPackaged(file){
 const relative=path.relative(mini,file).split(path.sep).join('/');
 return !ignored.some(entry=>entry.type==='file'?relative===entry.value:entry.type==='folder'&&(relative===entry.value||relative.startsWith(entry.value+'/')));
}
const packaged=all.filter(isPackaged);
bytes=packaged.reduce((sum,file)=>sum+fs.statSync(file).size,0);
const contentPolicy=require(path.join(mini,'data/content-policy'));
if(!contentPolicy.videoEnabled){
 for(const folder of ['media','media2','media3','assets/curated-video','assets/curated-poster'])if(!ignored.some(entry=>entry.type==='folder'&&entry.value===folder))issues.push('视频已停用，上传包必须排除 '+folder);
 if(!ignored.some(entry=>entry.type==='file'&&entry.value==='pages/post/_player.js'))issues.push('视频已停用，上传包必须排除 pages/post/_player.js');
 if(packages.some(pkg=>/^media[2-9]?$/.test(pkg.root)))issues.push('视频已停用，不可注册视频播放分包');
 for(const file of packaged)if(/\.(?:mp4|webm|mov|m4v)$/i.test(file)||path.relative(mini,file)==='pages/post/_player.js')issues.push('视频已停用，上传包必须排除 '+path.relative(mini,file));
 if(require(path.join(mini,'data/curated')).CURATED_POSTS.some(contentPolicy.isVideoPost))issues.push('视频已停用，内容目录不可包含历史视频');
}
const routes=app.pages.concat(packages.flatMap(pkg=>pkg.pages.map(page=>pkg.root+'/'+page)));
const product=require(path.join(mini,'product'));
if(product.personalMode){
 if(routes.some(route=>!product.PERSONAL_PAGES.includes(route)))issues.push('个人工具版包含已停用的社交页面');
 if(app.tabBar.list.some(tab=>tab.pagePath==='pages/messages/index'))issues.push('个人工具版不可注册社交消息导航');
}
for(const route of routes)if(!isPackaged(path.join(mini,route+'.js')))issues.push('已注册页面被上传排除：'+route);
for(const page of routes)for(const ext of ['.js','.json','.wxml','.wxss'])if(!fs.existsSync(path.join(mini,page+ext)))issues.push('缺少页面文件 '+page+ext);
for(const tab of app.tabBar.list)for(const field of ['iconPath','selectedIconPath'])if(!fs.existsSync(path.join(mini,tab[field])))issues.push('缺少导航图标 '+tab[field]);
for(const file of walk(path.join(root,'cloudfunctions')))if(file.endsWith('.js'))try{new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});}catch(error){issues.push(path.relative(root,file)+': '+error.message);}
for(const file of walk(path.join(root,'scripts')))if(file.endsWith('.js'))try{new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});}catch(error){issues.push(path.relative(root,file)+': '+error.message);}
for(const file of walk(path.join(root,'preview')))if(file.endsWith('.js'))try{new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});}catch(error){issues.push(path.relative(root,file)+': '+error.message);}
try{
 const schema=JSON.parse(fs.readFileSync(path.join(root,'infra/database.schema.json'),'utf8'));
 const setupSchema=JSON.parse(fs.readFileSync(path.join(root,'cloudfunctions/setup/schema.json'),'utf8'));
 const collections=require(path.join(root,'cloudfunctions/community/repository')).COLLECTIONS.map(name=>'yb_'+name).sort();
 if(JSON.stringify(schema)!==JSON.stringify(setupSchema))issues.push('初始化函数的数据库结构清单尚未同步');
 if(JSON.stringify(schema.collections.map(item=>item.name).sort())!==JSON.stringify(collections))issues.push('数据库结构清单与后端集合不一致');
 for(const collection of schema.collections){
  if(collection.rules.read!==false||collection.rules.write!==false)issues.push(collection.name+' 必须拒绝客户端直接读写');
  if(new Set(collection.indexes.map(index=>index.name)).size!==collection.indexes.length)issues.push(collection.name+' 索引名称重复');
 }
}catch(error){issues.push('基础设施配置检查失败：'+error.message);}
const packageBytes=packages.map(pkg=>({root:pkg.root,bytes:packaged.filter(file=>file.startsWith(path.join(mini,pkg.root)+path.sep)).reduce((sum,file)=>sum+fs.statSync(file).size,0)}));
const mainBytes=bytes-packageBytes.reduce((sum,pkg)=>sum+pkg.bytes,0);
if(mainBytes>2*1024*1024)issues.push('小程序主包大于2 MiB，请检查主包大小');
for(const pkg of packageBytes)if(pkg.bytes>2*1024*1024)issues.push('分包 '+pkg.root+' 大于2 MiB');
if(bytes>20*1024*1024)issues.push('小程序总包大于20 MiB');
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log(routes.length+' 个页面配置与脚本检查通过；主包 '+(mainBytes/1024).toFixed(1)+' KiB'+packageBytes.map(pkg=>'；分包 '+pkg.root+' '+(pkg.bytes/1024).toFixed(1)+' KiB').join('')+'。');
