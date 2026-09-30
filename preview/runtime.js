/* Local browser adapter for the SAME Page controllers, WXML and WXSS as WeChat. */
(() => {
  'use strict';
  const pageRoot=document.getElementById('mini-page');
  const overlay=document.getElementById('overlay');
  const moduleCache={};const definitions={};const tabs={};const badges={};
  let registering='',app=null,manifest=null,stack=[],current=null,renderQueued=false,toastTimer=null;
  let pointerRenderHeld=false,pointerRenderTimer=null;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const notifyFailure=error=>{console.error(error);toast(error.message||'操作未完成');};
  function asset(value){return value||'';}
  function moduleId(request,from){
    const parts=(request.startsWith('.')?from.slice(0,from.lastIndexOf('/')+1)+request:request).split('/');
    const resolved=[];for(const part of parts){if(part==='..')resolved.pop();else if(part&&part!=='.')resolved.push(part);}
    const id=resolved.join('/');return id.endsWith('.js')?id:id+'.js';
  }
  function requireModule(id){
    if(moduleCache[id])return moduleCache[id].exports;
    const factory=window.__miniModules[id];if(!factory)throw new Error('缺少模块：'+id);
    const module={exports:{}};moduleCache[id]=module;
    const previous=registering;registering=id.replace(/\.js$/,'');
    try{factory(request=>requireModule(moduleId(request,id)),module,module.exports);}finally{registering=previous;}
    return module.exports;
  }
  window.Page=definition=>{definitions[registering]=definition;};
  window.App=definition=>{app=definition;};
  window.getApp=()=>app;
  window.getCurrentPages=()=>stack.slice();
  function result(options,value,success=true){
    if(options){const fn=success?options.success:options.fail;if(fn)fn(value);if(options.complete)options.complete(value);}
    return value;
  }
  function toast(title,duration=2300){
    const el=document.getElementById('toast');clearTimeout(toastTimer);el.textContent=String(title);el.hidden=false;
    toastTimer=setTimeout(()=>{el.hidden=true;},duration);
  }
  function modal(options={}){
    return new Promise(resolve=>{
      overlay.replaceChildren();overlay.hidden=false;
      const dialog=document.createElement('div');dialog.className='dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      const title=document.createElement('h3');title.textContent=options.title||'有宠有邻';dialog.append(title);
      const content=document.createElement('p');content.textContent=options.content||'';dialog.append(content);
      const actions=document.createElement('div');actions.className='dialog-actions';
      function finish(confirm){overlay.hidden=true;overlay.replaceChildren();resolve(result(options,{confirm,cancel:!confirm}));}
      if(options.showCancel!==false){const cancel=document.createElement('button');cancel.textContent=options.cancelText||'取消';cancel.onclick=()=>finish(false);actions.append(cancel);}
      const ok=document.createElement('button');ok.className='primary';ok.textContent=options.confirmText||'确定';ok.onclick=()=>finish(true);actions.append(ok);
      dialog.append(actions);overlay.append(dialog);ok.focus();
    });
  }
  function actionSheet(options){
    return new Promise(resolve=>{
      overlay.replaceChildren();overlay.hidden=false;const dialog=document.createElement('div');dialog.className='dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','选择操作');
      const list=document.createElement('div');list.className='action-list';
      (options.itemList||[]).forEach((label,tapIndex)=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>{overlay.hidden=true;resolve(result(options,{tapIndex}));};list.append(button);});
      const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>{overlay.hidden=true;resolve(result(options,{errMsg:'showActionSheet:fail cancel'},false));};list.append(cancel);dialog.append(list);overlay.append(dialog);
    });
  }
  function previewImage(options){
    const images=options.urls||[];if(!images.length)return;
    let index=Math.max(0,images.indexOf(options.current));const focused=document.activeElement;overlay.hidden=false;
    const close=()=>{overlay.hidden=true;overlay.replaceChildren();if(focused&&focused.isConnected)focused.focus();};
    const move=step=>{const next=index+step;if(next>=0&&next<images.length){index=next;draw();}};
    const draw=()=>{
      overlay.replaceChildren();const wrap=document.createElement('div');wrap.className='image-viewer';wrap.setAttribute('role','dialog');wrap.setAttribute('aria-label','图片预览');wrap.tabIndex=-1;
      const img=document.createElement('img');img.src=images[index];img.alt='图片 '+(index+1)+' / '+images.length;img.draggable=false;
      const dismiss=document.createElement('button');dismiss.className='viewer-close';dismiss.textContent='×';dismiss.setAttribute('aria-label','关闭图片');dismiss.onclick=close;
      const count=document.createElement('span');count.className='viewer-counter';count.textContent=(index+1)+' / '+images.length;
      const previous=document.createElement('button');previous.className='viewer-previous';previous.textContent='‹';previous.setAttribute('aria-label','上一张图片');previous.disabled=index===0;previous.onclick=()=>move(-1);
      const next=document.createElement('button');next.className='viewer-next';next.textContent='›';next.setAttribute('aria-label','下一张图片');next.disabled=index===images.length-1;next.onclick=()=>move(1);
      let start=null;img.onpointerdown=e=>{start={x:e.clientX,y:e.clientY};};img.onpointerup=e=>{if(start&&Math.abs(e.clientX-start.x)>45&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y))move(e.clientX<start.x?1:-1);start=null;};
      wrap.onkeydown=e=>{if(e.key==='Escape')close();else if(e.key==='ArrowRight')move(1);else if(e.key==='ArrowLeft')move(-1);};
      wrap.append(img,dismiss);if(images.length>1)wrap.append(previous,count,next);overlay.append(wrap);wrap.focus();
    };draw();
  }
  async function compressImage(file){
    if(!file.type.startsWith('image/'))throw new Error('请选择图片文件');
    const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('这张图片无法打开，请换成 JPG 或 PNG'));el.src=source;});
    const scale=Math.min(1,1200/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fffefb';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.78);
  }
  function chooseMedia(options={},legacy=false){
    return new Promise(resolve=>{
      const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=(options.count||1)>1;input.hidden=true;document.body.append(input);
      input.addEventListener('cancel',()=>{input.remove();resolve(result(options,{errMsg:'chooseMedia:fail cancel'},false));});
      input.onchange=async()=>{try{const files=Array.from(input.files||[]).slice(0,options.count||3);if(!files.length)throw new Error('已取消选择');const urls=await Promise.all(files.map(compressImage));const data=legacy?{tempFilePaths:urls,tempFiles:urls.map(path=>({path,size:path.length}))}:{type:'image',tempFiles:urls.map(tempFilePath=>({tempFilePath,size:Math.ceil(tempFilePath.length*.75),fileType:'image'}))};resolve(result(options,data));}catch(error){result(options,{errMsg:error.message},false);resolve(null);}finally{input.remove();}};
      input.click();
    });
  }
  // Keep the v0.1 namespace so a brand update never discards the user's local content.
  function storageKey(key){return 'youban-preview:'+key;}
  window.wx={
    __preview:true,
    getStorageSync(key){const raw=localStorage.getItem(storageKey(key));if(raw===null)return '';try{return JSON.parse(raw);}catch{return raw;}},
    setStorageSync(key,value){try{localStorage.setItem(storageKey(key),JSON.stringify(value));}catch{throw new Error('本机存储空间不足，请减少图片或删除不需要的内容');}},
    removeStorageSync(key){localStorage.removeItem(storageKey(key));},
    getStorage(options){const data=this.getStorageSync(options.key);return Promise.resolve(result(options,{data}));},
    setStorage(options){try{this.setStorageSync(options.key,options.data);return Promise.resolve(result(options,{}));}catch(error){return Promise.resolve(result(options,{errMsg:error.message},false));}},
    removeStorage(options){this.removeStorageSync(options.key);return Promise.resolve(result(options,{}));},
    getStorageInfoSync(){return {keys:Object.keys(localStorage).filter(key=>key.startsWith('youban-preview:')).map(key=>key.slice(15)),currentSize:0,limitSize:5000};},
    showToast(options){toast(options.title,options.duration);return Promise.resolve(result(options,{}));},
    showLoading(options={}){toast(options.title||'请稍候…',60000);},hideLoading(){document.getElementById('toast').hidden=true;clearTimeout(toastTimer);},
    showModal:modal,showActionSheet:actionSheet,previewImage,
    getLocation(options){return Promise.resolve(result(options,{errMsg:'getLocation:fail preview unsupported; 请手选已核实地点作为参照'},false));},
    chooseLocation(options){return Promise.resolve(result(options,{errMsg:'chooseLocation:fail preview unsupported; 请手选已核实地点作为参照'},false));},
    // Preview-only bridge; WeChat has no general-purpose external-browser API.
    __openExternal(options){
      const value=options&&options.url;let target;
      try{target=new URL(value);}catch{return Promise.resolve(result(options,{errMsg:'openExternal:fail invalid url'},false));}
      if(typeof value!=='string'||/[\s\\<>"\u0000-\u001f\u007f]/.test(value)||/%(?![0-9a-f]{2})/i.test(value)||target.protocol!=='https:'||target.username||target.password)return Promise.resolve(result(options,{errMsg:'openExternal:fail invalid url'},false));
      window.location.assign(target.href);
      return Promise.resolve(result(options,{errMsg:'openExternal:ok',preview:true}));
    },
    openLocation(options){
      if(!Number.isFinite(options.latitude)||!Number.isFinite(options.longitude)||options.latitude < -90||options.latitude > 90||options.longitude < -180||options.longitude > 180)return Promise.resolve(result(options,{errMsg:'openLocation:fail invalid coordinates'},false));
      const marker='coord:'+options.latitude+','+options.longitude+';title:'+(options.name||'目的地')+';addr:'+(options.address||'');
      const url='https://apis.map.qq.com/uri/v1/marker?marker='+encodeURIComponent(marker)+'&referer='+encodeURIComponent('有宠有邻');
      // Embedded browsers may silently discard new-window requests. Keep the
      // destination in this tab so navigation works and browser Back returns here.
      window.location.assign(url);
      return Promise.resolve(result(options,{errMsg:'openLocation:ok browser map',preview:true}));
    },
    chooseMedia(options){return chooseMedia(options);},chooseImage(options){return chooseMedia(options,true);},
    loadSubpackage(options){queueMicrotask(()=>result(options,{}));return {onProgressUpdate(){}};},
    createVideoContext(id){const find=()=>Array.from(pageRoot.querySelectorAll('video')).find(el=>el.id===id);return {pause(){const el=find();if(el)el.pause();},play(){const el=find();if(el)el.play().catch(()=>{});},stop(){const el=find();if(el){el.pause();el.currentTime=0;}},seek(time){const el=find();if(el)el.currentTime=time;}};},
    saveFile(options){return Promise.resolve(result(options,{savedFilePath:options.tempFilePath}));},
    removeSavedFile(options){return Promise.resolve(result(options,{}));},
    getFileInfo(options){return Promise.resolve(result(options,{size:Math.ceil((options.filePath||'').length*.75)}));},
    navigateTo(options){return navigate(options.url,false).then(()=>result(options,{})).catch(error=>result(options,{errMsg:error.message},false));},
    redirectTo(options){if(stack.length){const old=stack.pop();invoke(old,'onUnload');}return navigate(options.url,false).then(()=>result(options,{}));},
    switchTab(options){return navigate(options.url,true).then(()=>result(options,{})).catch(error=>result(options,{errMsg:error.message},false));},
    reLaunch(options){return navigate(options.url,true).then(()=>result(options,{}));},
    navigateBack(options={}){if(stack.length<2){result(options,{errMsg:'navigateBack:fail no previous page'},false);return Promise.resolve();}for(let n=0;n<(options.delta||1)&&stack.length>1;n++)invoke(stack.pop(),'onUnload');current=stack[stack.length-1];updateLocation();render();invoke(current,'onShow');return Promise.resolve(result(options,{}));},
    setNavigationBarTitle(options){if(current)current.title=options.title;document.getElementById('native-title').textContent=options.title;},
    stopPullDownRefresh(){},startPullDownRefresh(){return invoke(current,'onPullDownRefresh');},
    pageScrollTo(options={}){
      let top=options.scrollTop||0;
      if(options.selector){
        let target;try{target=pageRoot.querySelector(options.selector);}catch{return result(options,{errMsg:'pageScrollTo:fail invalid selector'},false);}
        if(!target)return result(options,{errMsg:'pageScrollTo:fail selector not found'},false);
        top=pageRoot.scrollTop+target.getBoundingClientRect().top-pageRoot.getBoundingClientRect().top+(Number.isFinite(options.offsetTop)?options.offsetTop:0);
      }
      pageRoot.scrollTo({top,behavior:options.duration===0?'instant':'smooth'});
      return result(options,{errMsg:'pageScrollTo:ok'});
    },
    hideKeyboard(options={}){const active=document.activeElement;if(active&&/^(INPUT|TEXTAREA)$/.test(active.tagName)&&typeof active.blur==='function')active.blur();return result(options,{errMsg:'hideKeyboard:ok'});},
    setTabBarBadge(options){badges[options.index]=options.text;renderTabs();},removeTabBarBadge(options){delete badges[options.index];renderTabs();},
    showTabBarRedDot(options){badges[options.index]='•';renderTabs();},hideTabBarRedDot(options){delete badges[options.index];renderTabs();},
    showShareMenu(){},hideShareMenu(){},
    async setClipboardData(options){try{await navigator.clipboard.writeText(options.data);toast('已复制');result(options,{});}catch(error){result(options,{errMsg:error.message},false);}},
    getSystemInfoSync(){return {platform:'devtools',windowWidth:document.getElementById('device').clientWidth,windowHeight:pageRoot.clientHeight,statusBarHeight:0,safeArea:{bottom:pageRoot.clientHeight}};},
    getWindowInfo(){return this.getSystemInfoSync();},
    getAccountInfoSync(){return {miniProgram:{appId:'touristappid',envVersion:'develop'}};},
    canIUse(){return true;},nextTick(fn){queueMicrotask(fn);},vibrateShort(){},
    requestSubscribeMessage(options){return Promise.resolve(result(options,{}));}
  };
  function invoke(page,name,arg){
    if(!page||typeof page[name]!=='function')return Promise.resolve();
    try{return Promise.resolve(page[name](arg)).catch(notifyFailure);}catch(error){notifyFailure(error);return Promise.resolve();}
  }
  function patchData(target,path,value){const parts=path.replace(/\[(\d+)\]/g,'.$1').split('.');let item=target;parts.slice(0,-1).forEach((key,index)=>{if(!item[key])item[key]=/^\d+$/.test(parts[index+1])?[]:{};item=item[key];});item[parts[parts.length-1]]=value;}
  function makePage(route,query){
    requireModule(route+'.js');const def=definitions[route];if(!def)throw new Error('页面尚未准备好：'+route);
    const page={route,options:query,data:clone(def.data||{}),title:(manifest.pages[route].config||{}).navigationBarTitleText||'有宠有邻'};
    Object.keys(def).forEach(key=>{if(key!=='data')page[key]=typeof def[key]==='function'?def[key].bind(page):def[key];});
    page.setData=(values,callback)=>{Object.entries(values).forEach(([key,value])=>patchData(page.data,key,value));if(page===current)scheduleRender();if(callback)queueMicrotask(callback);};
    return page;
  }
  function isTab(route){return manifest.app.tabBar.list.some(item=>item.pagePath===route);}
  async function navigate(url,replace=false){
    const parsed=new URL(url.replace(/^\//,''),'http://mini/');const route=parsed.pathname.replace(/^\//,'');
    if(!manifest.pages[route])throw new Error('页面不存在');
    if(current){current.scrollTop=pageRoot.scrollTop;invoke(current,'onHide');}
    const query=Object.fromEntries(parsed.searchParams);let page;
    if(replace||isTab(route)){
      stack.filter(item=>!isTab(item.route)).forEach(item=>invoke(item,'onUnload'));
      page=tabs[route];if(!page){page=makePage(route,query);if(isTab(route))tabs[route]=page;}
      stack=[page];
    }else{page=makePage(route,query);stack.push(page);}
    current=page;updateLocation();render();
    if(!page.__loaded){page.__loaded=true;invoke(page,'onLoad',query);}
    invoke(page,'onShow');pageRoot.scrollTop=page.scrollTop||0;
    // Match WeChat's first-render lifecycle. Media controllers must not start
    // native playback before both this event and their source view commit.
    if(!page.__ready){page.__ready=true;queueMicrotask(()=>{if(stack.includes(page)||tabs[page.route]===page)invoke(page,'onReady');});}
  }
  function updateLocation(){
    const params=new URLSearchParams(current.options).toString();const hash='#/'+current.route+(params?'?'+params:'');history.replaceState({},'',hash);
    document.getElementById('native-back').hidden=isTab(current.route);
    document.getElementById('native-title').textContent=current.title;
    document.getElementById('device').classList.toggle('custom-navigation',manifest.pages[current.route].config.navigationStyle==='custom');
  }
  function nativeBack(){
    // Returning from a same-tab map/article can reload a detail directly. Keep
    // its exit available without persisting or reconstructing the old stack.
    const nearby=/^pages\/(?:local-detail|places|places-manage|event|web)\/index$/.test(current&&current.route||'');
    return window.wx.navigateBack({fail:()=>window.wx.switchTab({url:nearby?'/pages/nearby/index':'/pages/community/index'})});
  }
  const expressionCache=new Map();
  function evaluate(expression,scope){
    try{let fn=expressionCache.get(expression);if(!fn){fn=new Function('scope','with(scope){return ('+expression+');}');expressionCache.set(expression,fn);}return fn(scope);}catch{return undefined;}
  }
  function interpolate(value,scope){
    const full=/^\s*{{([\s\S]*?)}}\s*$/.exec(value);if(full&&!full[1].includes('}}'))return evaluate(full[1],scope);
    return value.replace(/{{([\s\S]*?)}}/g,(_,exp)=>{const result=evaluate(exp,scope);return result==null?'':String(result);});
  }
  function truth(value,scope){return !!interpolate(value,scope);}
  function eventFor(element,detail,event){return {type:event.type,detail:detail||{},currentTarget:{dataset:{...element.dataset}},target:{dataset:{...event.target.dataset}},stopPropagation:()=>event.stopPropagation()};}
  function handle(page,method,element,detail,event,stop=false){
    if(stop)event.stopPropagation();
    if(element.disabled||element._previewRetired)return;
    if(typeof page[method]!=='function'){console.error('Missing page handler',page.route,method);return;}
    invoke(page,method,eventFor(element,detail,event));
  }
  function makeTemplate(source){
    const html=source.replace(/<([\w-]+)(\s[^<>]*?)?\s*\/>/g,(match,tag,attrs)=>'<'+tag+(attrs||'')+'></'+tag+'>');
    const doc=new DOMParser().parseFromString('<main>'+html+'</main>','text/html');return doc.querySelector('main');
  }
  function renderChildren(nodes,parent,scope,page,path){
    let inChain=false,matched=false;
    Array.from(nodes).forEach((node,index)=>{
      if(node.nodeType===3){const text=interpolate(node.textContent,scope);if(String(text==null?'':text).trim())parent.append(document.createTextNode(text==null?'':String(text)));return;}
      if(node.nodeType!==1)return;
      const hasIf=node.hasAttribute('wx:if'),hasElif=node.hasAttribute('wx:elif'),hasElse=node.hasAttribute('wx:else');
      if(hasIf){inChain=true;matched=truth(node.getAttribute('wx:if'),scope);if(!matched)return;}
      else if(hasElif){if(!inChain||matched)return;matched=truth(node.getAttribute('wx:elif'),scope);if(!matched)return;}
      else if(hasElse){if(!inChain||matched)return;matched=true;}
      else {inChain=false;matched=false;}
      renderNode(node,parent,scope,page,path+'-'+index);
    });
  }
  function renderNode(node,parent,scope,page,path,skipFor=false){
    if(node.hasAttribute('wx:for')&&!skipFor){
      const values=interpolate(node.getAttribute('wx:for'),scope)||[];
      if(Array.isArray(values)||typeof values==='object')Object.entries(values).forEach(([index,item])=>{const child=Object.assign({},scope);child[node.getAttribute('wx:for-item')||'item']=item;child[node.getAttribute('wx:for-index')||'index']=Array.isArray(values)?Number(index):index;renderNode(node,parent,child,page,path+'-'+index,true);});return;
    }
    const tag=node.tagName.toLowerCase();
    // HTML parsing normalizes WXML's <image> to <img> before rendering.
    const native=tag==='img'?'image':tag;
    if(native==='block'){renderChildren(node.childNodes,parent,scope,page,path);return;}
    const map={view:'div',text:'span',image:'img','scroll-view':'div',picker:'div',navigator:'a',switch:'input',swiper:'div','swiper-item':'div'};
    // Keep an in-flight image attached to its request across unrelated setData
    // renders. Source/attempt changes intentionally create a fresh image.
    const imageKey=native==='image'||native==='video'?JSON.stringify([native,path,asset(interpolate(node.getAttribute('src')||'',scope)),interpolate(node.getAttribute('data-id')||'',scope),interpolate(node.getAttribute('data-attempt')||'',scope)]):null;
    const previousImage=imageKey&&page._previewImageNodes&&page._previewImageNodes.get(imageKey);
    const el=previousImage||document.createElement(map[native]||native);
    if(previousImage)for(const attr of Array.from(el.attributes))if(!['src','loading','decoding'].includes(attr.name))el.removeAttribute(attr.name);
    el.dataset.previewKey=path;
    if(imageKey&&page._previewNextImages)page._previewNextImages.set(imageKey,el);
    if(native==='image'){
      const lazy=node.hasAttribute('lazy-load')?interpolate(node.getAttribute('lazy-load'),scope):false;
      const loading=lazy===''||lazy===true||lazy==='true'?'lazy':'eager';
      if(el.loading!==loading)el.loading=loading;
      if(el.decoding!=='async')el.decoding='async';
    }
    if(native==='video'){el.preload='metadata';el.playsInline=true;}
    for(const attr of Array.from(node.attributes)){
      const name=attr.name;if(name.startsWith('wx:')||name.startsWith('bind')||name.startsWith('catch')||['range','range-key','mode','value'].includes(name))continue;
      const value=interpolate(attr.value,scope);
      if(['disabled','hidden','checked','controls','autoplay','loop','muted'].includes(name)){el[name]=value!==false&&value!=='false'&&value!=null;continue;}
      if(name==='maxlength'){el.maxLength=Number(value);continue;}
      if(name==='class'){el.className=value||'';continue;}
      if(name==='style'){el.setAttribute('style',rpx(String(value||'')));continue;}
      if(name==='src'){if(!previousImage)el.src=asset(value);continue;}
      if(value!=null)el.setAttribute(name,String(value));
    }
    if(native==='button'){el.type='button';if(!node.getAttribute('aria-label'))el.setAttribute('aria-label',String(interpolate(node.textContent,scope)).trim()||'操作');}
    if(native==='image'){el.classList.add('mp-image');const mode=interpolate(node.getAttribute('mode')||'scaleToFill',scope);if(mode==='aspectFit')el.style.objectFit='contain';if(mode==='widthFix')el.style.height='auto';el.alt=node.getAttribute('alt')||'';}
    if(native==='scroll-view'&&truth(node.getAttribute('scroll-x')||'',scope))el.classList.add('mp-scroll-horizontal');
    if(native==='scroll-view'&&el.classList.contains('mp-scroll-horizontal')&&!truth(node.getAttribute('scroll-y')||'',scope)){
      const method=node.getAttribute('bindscroll')||node.getAttribute('bind:scroll');
      if(method)el.addEventListener('scroll',event=>handle(page,method,el,{scrollTop:el.scrollTop,scrollLeft:el.scrollLeft,scrollHeight:el.scrollHeight,scrollWidth:el.scrollWidth},event));
    }
    if(native==='scroll-view'&&node.hasAttribute('scroll-y')&&(node.getAttribute('scroll-y')===''||truth(node.getAttribute('scroll-y'),scope))){
      el.classList.add('mp-scroll-vertical');
      el.addEventListener('scroll',event=>{
        const detail={scrollTop:el.scrollTop,scrollLeft:el.scrollLeft,scrollHeight:el.scrollHeight,scrollWidth:el.scrollWidth};
        const method=node.getAttribute('bindscroll')||node.getAttribute('bind:scroll');if(method)handle(page,method,el,detail,event);
        const lower=node.getAttribute('bindscrolltolower')||node.getAttribute('bind:scrolltolower');
        if(lower&&el.scrollTop+el.clientHeight>=el.scrollHeight-Number(node.getAttribute('lower-threshold')||50))handle(page,lower,el,detail,event);
      });
    }
    if(native==='image'&&!previousImage){
      const method=node.getAttribute('binderror')||node.getAttribute('bind:error');
      if(method)el.addEventListener('error',event=>handle(page,method,el,{errMsg:'图片暂时无法加载'},event));
      const load=node.getAttribute('bindload')||node.getAttribute('bind:load');
      if(load)el.addEventListener('load',event=>handle(page,load,el,{width:el.naturalWidth,height:el.naturalHeight},event));
    }
    if(native==='video'&&!previousImage){
      for(const type of ['error','waiting','loadedmetadata','play','pause','timeupdate','ended']){
        const method=node.getAttribute('bind'+type)||node.getAttribute('bind:'+type);
        if(method)el.addEventListener(type,event=>handle(page,method,el,{currentTime:el.currentTime,duration:el.duration,errMsg:type==='error'?'视频暂时无法播放':''},event));
      }
      const ready=node.getAttribute('bindplay');if(ready)el.addEventListener('playing',event=>handle(page,ready,el,{},event));
    }
    if(native==='swiper'){
      el.classList.add('mp-swiper');el.dataset.current=String(interpolate(node.getAttribute('current')||'0',scope)||0);
      let timer;el.addEventListener('scroll',event=>{clearTimeout(timer);timer=setTimeout(()=>{if(!el.isConnected||!el.clientWidth)return;const index=Math.round(el.scrollLeft/el.clientWidth);if(index===Number(el.dataset.current))return;const method=node.getAttribute('bindchange');if(method)handle(page,method,el,{current:index,source:'touch'},event);},90);});
    }
    if(native==='swiper-item')el.classList.add('mp-swiper-item');
    if(native==='input'||native==='textarea'){
      const value=interpolate(node.getAttribute('value')||'',scope);el.value=value==null?'':String(value);
      if(native==='textarea'&&node.hasAttribute('auto-height')){el.rows=1;el.dataset.autoHeight='true';}
      const type=node.getAttribute('type');if(native==='input')el.type=type==='digit'?'number':type==='number'?'number':type||'text';
      el.addEventListener('input',event=>{const method=node.getAttribute('bindinput')||node.getAttribute('bind:input');if(method)handle(page,method,el,{value:el.value,cursor:el.selectionStart},event);});
      if(node.hasAttribute('focus')){const focus=interpolate(node.getAttribute('focus'),scope);el._previewFocusRequested=focus===''||focus===true||focus==='true';}
      for(const type of ['focus','blur'])el.addEventListener(type,event=>{
        if(el._previewRestoringFocus||el._previewRetired)return;
        const method=node.getAttribute('bind'+type)||node.getAttribute('bind:'+type);if(method)handle(page,method,el,{value:el.value,height:0},event);
        // The desktop preview has no native on-screen keyboard. Report its
        // actual zero height rather than reserving a simulated keyboard gap.
        const keyboard=node.getAttribute('bindkeyboardheightchange')||node.getAttribute('bind:keyboardheightchange');if(keyboard)handle(page,keyboard,el,{height:0,duration:0},event);
      });
      const confirm=node.getAttribute('bindconfirm')||node.getAttribute('bind:confirm');
      if(confirm)el.addEventListener('keydown',event=>{if(event.key==='Enter'&&native==='input'){event.preventDefault();handle(page,confirm,el,{value:el.value},event);}});
    }
    if(native==='switch'){
      el.type='checkbox';el.classList.add('mp-switch');el.setAttribute('role','switch');
      el.setAttribute('aria-label',node.getAttribute('aria-label')||'切换设置');
      el.addEventListener('change',event=>{const method=node.getAttribute('bindchange')||node.getAttribute('bind:change');if(method)handle(page,method,el,{value:el.checked},event);});
    }
    if(native==='picker'){
      el.classList.add('mp-picker');renderChildren(node.childNodes,el,scope,page,path);
      const mode=node.getAttribute('mode')||'selector';const control=document.createElement(mode==='date'||mode==='time'?'input':'select');control.className='mp-picker-control';control.dataset.previewKey=path+'-picker';
      if(mode==='date'||mode==='time'){control.type=mode;control.value=String(interpolate(node.getAttribute('value')||'',scope)||'');const start=node.getAttribute('start'),end=node.getAttribute('end');if(start)control.min=interpolate(start,scope);if(end)control.max=interpolate(end,scope);}
      else {const range=interpolate(node.getAttribute('range')||'{{[]}}',scope)||[];const key=node.getAttribute('range-key');range.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=key?item[key]:String(item);control.append(option);});control.value=String(interpolate(node.getAttribute('value')||'0',scope)||0);}
      control.setAttribute('aria-label',el.textContent.trim()||'选择');control.disabled=!!el.disabled;control.onchange=event=>{const method=node.getAttribute('bindchange')||node.getAttribute('bind:change');if(method)handle(page,method,el,{value:mode==='selector'?Number(control.value):control.value},event);};el.append(control);
    } else if(!['image','input','textarea','switch'].includes(native))renderChildren(node.childNodes,el,scope,page,path);
    const tap=node.getAttribute('bindtap')||node.getAttribute('bind:tap');const catchTap=node.getAttribute('catchtap')||node.getAttribute('catch:tap');
    if(tap||catchTap){if(!previousImage)el.addEventListener('click',event=>handle(page,catchTap||tap,el,{},event,!!catchTap));if(native!=='button'&&native!=='input'&&native!=='textarea'&&native!=='picker'){el.setAttribute('role','button');el.tabIndex=0;if(!previousImage)el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});}}
    if(native==='navigator')el.onclick=event=>{event.preventDefault();wx.navigateTo({url:interpolate(node.getAttribute('url')||'',scope)});};
    parent.append(el);
  }
  function rpx(css){return css.replace(/(-?\d*\.?\d+)rpx\b/g,'calc($1 * var(--rpx))');}
  const styleCache=new Map();
  function nativeCss(css){
    if(styleCache.has(css))return styleCache.get(css);
    let translated=rpx(css);
    for(const [tags,to] of [['view|scroll-view|picker','div'],['text','span'],['image','img']]){
      translated=translated.replace(new RegExp('(^|[\\s,>+~])('+tags+')(?=\\s|[,{:.>+~]|\\[)','g'),'$1'+to);
    }
    const sheet=new CSSStyleSheet();sheet.replaceSync(translated);
    const scopeRule=rule=>{
      if(rule.type===1){const selectors=rule.selectorText.split(',').map(value=>{const s=value.trim();return s==='page'?'#mini-page':s.startsWith('page ')?'#mini-page'+s.slice(4):'#mini-page '+s;});return selectors.join(',')+'{'+rule.style.cssText+'}';}
      if(rule.type===4||rule.type===12)return rule.cssText.slice(0,rule.cssText.indexOf('{')+1)+Array.from(rule.cssRules).map(scopeRule).join('')+'}';
      return rule.cssText;
    };
    const result=Array.from(sheet.cssRules).map(scopeRule).join('');styleCache.set(css,result);return result;
  }
  function renderTabs(){
    if(!manifest||!current)return;const nav=document.getElementById('native-tabs');nav.hidden=!isTab(current.route);nav.replaceChildren();
    manifest.app.tabBar.list.forEach((item,index)=>{const active=current.route===item.pagePath;const button=document.createElement('button');button.className=active?'is-active':'';if(active)button.setAttribute('aria-current','page');const img=document.createElement('img');img.src='/'+(active?item.selectedIconPath:item.iconPath);img.alt='';const label=document.createElement('span');label.textContent=item.text;button.append(img,label);if(badges[index]){const badge=document.createElement('span');badge.className='tab-badge';badge.textContent=badges[index];button.append(badge);}button.onclick=()=>navigate('/'+item.pagePath,true);nav.append(button);});
  }
  function flushRender(){if(!renderQueued||pointerRenderHeld)return;renderQueued=false;render();}
  function scheduleRender(){if(renderQueued)return;renderQueued=true;queueMicrotask(flushRender);}
  function installInputClickGuard(){
    const release=()=>{clearTimeout(pointerRenderTimer);pointerRenderTimer=null;pointerRenderHeld=false;if(renderQueued)queueMicrotask(flushRender);};
    const begin=event=>{
      const focused=document.activeElement;
      if(event.button!==undefined&&event.button!==0||!focused||focused===event.target||!pageRoot.contains(focused)||!['INPUT','TEXTAREA'].includes(focused.tagName))return;
      // A pointer press blurs the input before its eventual click. Keep the
      // original click target mounted while blur/keyboard handlers update data.
      clearTimeout(pointerRenderTimer);pointerRenderTimer=null;pointerRenderHeld=true;
    };
    const finish=()=>{
      if(!pointerRenderHeld)return;
      // A task, rather than a microtask, also covers capture listeners and the
      // native pointerup -> mouseup -> click sequence without cancelling focus.
      clearTimeout(pointerRenderTimer);pointerRenderTimer=setTimeout(release,0);
    };
    for(const type of ['pointerdown','mousedown'])document.addEventListener(type,begin,true);
    for(const type of ['pointerup','mouseup','click'])document.addEventListener(type,finish,true);
    for(const type of ['pointercancel','contextmenu'])document.addEventListener(type,release,true);
    window.addEventListener('blur',release);
  }
  function restoreInputFocus(page,focusKey,selection){
    const nodes=Array.from(pageRoot.querySelectorAll('[data-preview-key]'));
    const previous=page._previewFocusRequests||new Map(),next=new Map();let requested=null;
    for(const el of nodes)if(typeof el._previewFocusRequested==='boolean'){
      const key=el.dataset.previewKey;next.set(key,el._previewFocusRequested);
      if(el._previewFocusRequested&&previous.get(key)!==true&&!el.disabled)requested=el;
    }
    page._previewFocusRequests=next;
    if(requested){requested.focus({preventScroll:true});return;}
    const replacement=focusKey&&nodes.find(el=>el.dataset.previewKey===focusKey);
    if(!replacement||replacement.disabled||previous.get(focusKey)===true&&next.get(focusKey)===false)return;
    // DOM replacement is a preview implementation detail, not a new native
    // focus event; suppress handlers while restoring the cursor after setData.
    replacement._previewRestoringFocus=true;
    try{replacement.focus({preventScroll:true});if(selection&&replacement.setSelectionRange){try{replacement.setSelectionRange(selection.start,selection.end);}catch{}}}
    finally{replacement._previewRestoringFocus=false;}
  }
  function replacePageContent(fragment){
    // Removing a focused field may emit blur now or after the next render.
    // Those retired nodes must never turn DOM replacement into a keyboard
    // change that schedules another render and starts the same cycle again.
    const retired=Array.from(pageRoot.querySelectorAll('input,textarea'));
    retired.forEach(el=>{el._previewRetired=true;});
    try{pageRoot.replaceChildren(fragment);}
    catch(error){retired.forEach(el=>{el._previewRetired=false;});throw error;}
  }
  function render(){
    if(!current)return;const def=manifest.pages[current.route];
    if(!def.template){pageRoot.innerHTML='<div class="boot-loading">这个页面还在写入中，请稍后刷新。</div>';return;}
    const focused=document.activeElement;const focusKey=pageRoot.contains(focused)?focused.dataset.previewKey:null;const selection=focusKey&&typeof focused.selectionStart==='number'?{start:focused.selectionStart,end:focused.selectionEnd}:null;
    const scroll=pageRoot.scrollTop;
    const playing=Array.from(pageRoot.querySelectorAll('video')).filter(el=>!el.paused&&!el.ended).map(el=>({el,time:el.currentTime}));
    const swipers=new Map(Array.from(pageRoot.querySelectorAll('.mp-swiper')).map(el=>[el.dataset.previewKey,{current:el.dataset.current,left:el.scrollLeft}]));
    const scrollers=new Map(Array.from(pageRoot.querySelectorAll('.mp-scroll-vertical,.mp-scroll-horizontal')).map(el=>[el.dataset.previewKey,{top:el.scrollTop,left:el.scrollLeft,target:el.getAttribute('scroll-into-view'),atBottom:el.scrollTop+el.clientHeight>=el.scrollHeight-90}]));
    document.getElementById('mini-page-style').textContent=nativeCss(def.style);
    const fragment=document.createDocumentFragment();const template=makeTemplate(def.template);current._previewNextImages=new Map();renderChildren(template.childNodes,fragment,current.data,current,'n');replacePageContent(fragment);current._previewImageNodes=current._previewNextImages;delete current._previewNextImages;
    for(const {el,time} of playing)if(!document.hidden&&el.isConnected&&el.paused){if(Math.abs(el.currentTime-time)>.2)el.currentTime=time;el.play().catch(()=>{});}
    for(const el of pageRoot.querySelectorAll('.mp-swiper')){const prior=swipers.get(el.dataset.previewKey);el.scrollLeft=prior&&prior.current===el.dataset.current?prior.left:Number(el.dataset.current)*el.clientWidth;}
    for(const input of pageRoot.querySelectorAll('textarea[data-auto-height]')){input.style.height='auto';input.style.height=input.scrollHeight+'px';}
    for(const el of pageRoot.querySelectorAll('.mp-scroll-vertical,.mp-scroll-horizontal')){
      const prior=scrollers.get(el.dataset.previewKey);if(prior){el.scrollTop=prior.top;el.scrollLeft=prior.left;}
      const targetId=el.getAttribute('scroll-into-view');
      if(targetId&&(!prior||targetId!==prior.target||targetId==='chat-bottom'&&prior.atBottom)){
        const target=Array.from(el.querySelectorAll('[id]')).find(item=>item.id===targetId);
        if(target)el.scrollTop+=target.getBoundingClientRect().top-el.getBoundingClientRect().top;
      }
    }
    restoreInputFocus(current,focusKey,selection);
    pageRoot.scrollTop=scroll;renderTabs();
  }
  function fatal(error){console.error(error);pageRoot.replaceChildren();const block=document.createElement('div');block.className='boot-loading';block.textContent='暂时没能打开：'+error.message+'。请确认页面文件已经生成，再刷新浏览器。';pageRoot.append(block);}
  function installPullDownRefresh(){
    let gesture=null,refreshing=false,suppressClickUntil=0;
    const eligible=page=>page&&page===current&&manifest.pages[page.route].config.enablePullDownRefresh===true&&typeof page.onPullDownRefresh==='function'&&pageRoot.scrollTop<=1&&overlay.hidden&&!pageRoot.querySelector('.community-filter-layer,[aria-modal="true"],[role="dialog"]');
    const begin=(event,point,kind)=>{
      if(refreshing||!eligible(current)||event.target.closest('button,input,textarea,select,a,[contenteditable="true"],.mp-scroll-horizontal,.mp-scroll-vertical'))return;
      gesture={page:current,kind,id:point.identifier??point.pointerId,x:point.clientX,y:point.clientY,distance:0};
    };
    const move=(event,point,kind)=>{
      if(!gesture||gesture.kind!==kind||!point||gesture.id!==(point.identifier??point.pointerId))return;
      if(!eligible(gesture.page)){gesture=null;return;}
      const dx=Math.abs(point.clientX-gesture.x),dy=point.clientY-gesture.y;
      if(dy< -6||(dx>12&&dx>Math.abs(dy))){gesture=null;return;}
      gesture.distance=dy;
      if(dy>6&&dy>dx*1.25){
        if(event.cancelable)event.preventDefault();
        if(kind==='pointer'&&!pageRoot.hasPointerCapture(event.pointerId))pageRoot.setPointerCapture(event.pointerId);
      }
    };
    const finish=(point,kind)=>{
      if(!gesture||gesture.kind!==kind||!point||gesture.id!==(point.identifier??point.pointerId))return;
      const saved=gesture;gesture=null;
      if(saved.distance>6)suppressClickUntil=Date.now()+500;
      const dy=point.clientY-saved.y,dx=Math.abs(point.clientX-saved.x);
      if(dy<64||dy<=dx*1.25||!eligible(saved.page))return;
      refreshing=true;invoke(saved.page,'onPullDownRefresh').finally(()=>{refreshing=false;});
    };
    pageRoot.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'&&event.isPrimary&&event.button===0)begin(event,event,'pointer');});
    pageRoot.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')move(event,event,'pointer');});
    pageRoot.addEventListener('pointerup',event=>{if(event.pointerType!=='touch')finish(event,'pointer');});
    pageRoot.addEventListener('pointercancel',()=>{if(gesture&&gesture.kind==='pointer')gesture=null;});
    pageRoot.addEventListener('touchstart',event=>{if(event.touches.length===1)begin(event,event.touches[0],'touch');else gesture=null;},{passive:true});
    pageRoot.addEventListener('touchmove',event=>{if(event.touches.length===1)move(event,event.touches[0],'touch');else gesture=null;},{passive:false});
    pageRoot.addEventListener('touchend',event=>finish(event.changedTouches[0],'touch'));
    pageRoot.addEventListener('touchcancel',()=>{gesture=null;});
    pageRoot.addEventListener('dragstart',event=>{if(gesture)event.preventDefault();});
    pageRoot.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();suppressClickUntil=0;}},true);
  }
  async function start(){
    manifest=await fetch('/__manifest.json').then(res=>res.json());document.getElementById('mini-global-style').textContent=nativeCss(manifest.style);
    const size=()=>{document.documentElement.style.setProperty('--rpx',document.getElementById('device').clientWidth/750+'px');};new ResizeObserver(size).observe(document.getElementById('device'));size();
    requireModule('app.js');if(app&&app.onLaunch)app.onLaunch();
    document.getElementById('native-back').onclick=nativeBack;
    document.getElementById('native-menu').onclick=()=>modal({title:'有宠有邻 · 本机体验',content:'喜欢宠物，就在这里相遇。可以试试发布、收藏、关注和活动报名。示例内容与操作仅保存在当前浏览器；接入自己的微信小程序账号和云端后，才能与好友共同使用。',showCancel:false,confirmText:'知道了'});
    let reachTimer;pageRoot.addEventListener('scroll',()=>{clearTimeout(reachTimer);reachTimer=setTimeout(()=>{if(pageRoot.scrollTop+pageRoot.clientHeight>=pageRoot.scrollHeight-80)invoke(current,'onReachBottom');},120);});
    installInputClickGuard();
    installPullDownRefresh();
    document.addEventListener('visibilitychange',()=>invoke(current,document.hidden?'onHide':'onShow'));
    window.addEventListener('pagehide',()=>invoke(current,'onHide'));
    const initial=location.hash.startsWith('#/')?location.hash.slice(1):'/pages/community/index';await navigate(initial,isTab(initial.split('?')[0].slice(1)));
  }
  window.MiniPreview={start,fatal,navigate,get current(){return current;},get manifest(){return manifest;}};
})();
