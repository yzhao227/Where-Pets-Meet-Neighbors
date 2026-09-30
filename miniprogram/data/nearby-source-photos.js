'use strict';

// Verified images from the listed articles; original CDN files preserve their credits.
const sources = ["https://www.scpgroup.com/business/data?cname=project&id=62","https://www.shobserver.com/sgh/detail?id=1744115","https://whlyj.sh.gov.cn/gqfc/20240221/7ffebbbb812e4dcbb7eaa82feb796066.html","https://finance.sina.com.cn/wm/2026-09-26/doc-initcyyy8482170.shtml","https://www.meet-in-shanghai.net/cn/attraction/shanghai-changfeng-park-and-changfeng-ocean-world-scenic-area-750928/","https://news.qq.com/rain/a/20251027A06CW700","https://www.sohu.com/a/1041579336_121124417","https://www.petfairasia.com/news/441.html","https://m.thepaper.cn/newsDetail_forward_32958308","https://finance.sina.com.cn/wm/2026-09-29/doc-initnscx7762391.shtml","https://www.jinshan.gov.cn/shfw-bmxx/20260917/878841.html","https://news.sina.cn/sx/2026-09-24/detail-inisxnvc0383733.d.html?vt=4","https://www.shobserver.com/staticsg/res/html/web/newsDetail.html?id=1186234","https://finance.sina.com.cn/jjxw/2026-06-07/doc-iniapryw9995725.shtml"];
const images = {
  "place-xinzhuang-weijing": ["https://www.scpgroup.com/uploads/2022-03-30/6243f7f128b28.jpg",0,"印力集团","莘庄维璟印象城外观 · 原文实拍","photo"],
  "place-zhongsheng": ["https://sghimages.shobserver.com/img/catch/2026/05/02/53f3e33f-d656-4972-9178-f22b5d941044.jpg",1,"今日闵行（上观新闻）","仲盛世界商城南下沉广场 · 原文实拍","photo"],
  "place-xincheng-central": ["https://whlyj.sh.gov.cn/cmsres/9b/9bb2c3d9e517444389b3fbaab7f891b8/bd9a3cd4ca76075c32173c20d536dbb6.jpg",2,"上海市文化和旅游局 · 失落地方","莘城中央公园银杏 · 原文秋景，非当前叶色","photo"],
  "place-fuyuehui-pet-park": ["https://n.sinaimg.cn/sinakd20260926s/178/w1080h698/20260926/8a35-49a8469fada13a754db4c8eb83157965.png",3,"上海普陀（新浪转载）","复悦荟宠物公园障碍设施 · 原文实拍","photo"],
  "place-changfeng-ocean-world": ["https://www.meet-in-shanghai.net/static//upload/mainpic/20211222145725_192209961.jpg",4,"上海旅游会展推广中心","长风海洋世界入口 · 原文实拍","photo"],
  "place-gubei-citizen-park": ["https://inews.gtimg.com/om_bt/OT59NK1uV1qXfZjN8qejzE_U2abIAthZyh2W3C3EDzh4EAA/641",5,"新闻晨报（极目新闻·腾讯转载）","古北市民公园草坪 · 原文实拍","photo"],
  "place-haisu-park-pet-zones": ["https://inews.gtimg.com/om_bt/Ow4lRuNBYZYlS-ZDPrfJgCU57daKBiFBe18Aur5L72sx4AA/641",5,"新闻晨报（极目新闻·腾讯转载）","海粟公园宠物饮水与清洁设施 · 原文实拍","photo"],
  "place-yuehu-sculpture": ["https://q9.itc.cn/q_70/images03/20260625/89d356b37546462d81ba40d02975d67c.jpeg",6,"月湖雕塑公园（搜狐转载）","月湖雕塑公园湖畔 · 原文实拍","photo"],
  "notice-pfa-boutique-2027": ["https://www.petfairasia.com/public/upload/20260826/260R61143132H.jpg",7,"亚洲宠物展主办方","亚宠甄选特展官方预告海报","poster"],
  "event-petfair-asia-2026": ["https://www.petfairasia.com/public/upload/20260826/260R6113002362.jpg",7,"亚洲宠物展主办方","第28届亚洲宠物展官方收官报道配图","photo"],
  "event-weijing-spartan-2026": ["https://imgpai.thepaper.cn/pphimage/20260413/6f868747-a569-420e-80db-e7a047a4992c.jpg",8,"今日闵行 · 素材：辛向荣","莘庄维璟狗狗斯巴达勇士赛原文海报","poster"],
  "event-dingfeng-pets-2026": ["https://n.sinaimg.cn/spider20260929/199/w1080h719/20260929/9a9e-3d758a00f98c22c0a36749e3b68aa9a0.jpg",9,"上海奉贤 / 奉发集团（新浪转载）","鼎丰酱园宠物活动原文配图","photo"],
  "event-baijia-pet-market-2026": ["https://www.jinshan.gov.cn/shfw-bmxx/20260917/878841/29b7e170f982400aaf8df969ba21911a.jpg",10,"上海市金山区人民政府","百家村萌宠市集原文招募海报","poster"],
  "event-shenlong-pet-adventure-2026": ["https://k.sinaimg.cn/n/spider20260924/72/w558h314/20260924/4134-1c3c3b6a351046a49434141289924adb.png/w700d1q75cms.jpg?by=cms_fixed_width",11,"资讯中国（新浪转载宣传稿）","申隆·宠物冒险岛水上活动原文配图","photo"],
  "event-monaco-dog-show-2026": ["https://images.shobserver.com/img/2026/09/28/l_CB20260928215124504031.jpeg",12,"岑佳宁 / 上观新闻·新民晚报","旗忠网球中心ACE萌友天地原文实拍","photo"],
  "place-libopark": ["https://n.sinaimg.cn/spider20260607/264/w640h424/20260607/3560-8f0f0d658d8f41c756f600c3eebf5f36.jpg",13,"上观新闻（新浪财经转载）","力波公园 · 原文实拍","photo"],
  "place-yuanjiang-tod": ["https://n.sinaimg.cn/spider20260607/266/w640h426/20260607/070c-1897f7871c6daf0849af6ce4ffd26621.jpg",13,"上观新闻（新浪财经转载）","元江路 TOD 公园 · 原文实拍","photo"],
  "place-lanxiang-lake": ["https://n.sinaimg.cn/spider20260607/245/w640h405/20260607/1293-131c6629fb3af1d2005a5c1229819138.jpg",13,"上观新闻（新浪财经转载）","兰香湖 · 原文实拍","photo"],
  "place-starbucks-zizhu": ["https://n.sinaimg.cn/spider20260607/586/w576h810/20260607/4ec2-997e00cdb4e0aa29c408884cbfa58591.jpg",13,"上观新闻（新浪财经转载）","星巴克（上海紫竹半岛店） · 原文实拍","photo"],
};

// Overlay existing saved records as well as the bundled catalogue without changing
// their text or state. A changed source must be reviewed before using these photos.
module.exports = record => {
  const image = images[record.id];
  if (!image || !(record.sources || []).some(source => source.url === sources[image[1]])) return record;
  return { ...record, photo: { url: image[0], sourceUrl: sources[image[1]], credit: image[2], caption: image[3], kind: image[4], license: '原文配图 · 未标注开放许可' } };
};
