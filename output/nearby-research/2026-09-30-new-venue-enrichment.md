# 2026-09-30 新增场馆图片与坐标

新增独立模块 `miniprogram/data/nearby-enrichment-20260930.js`，由根任务合并至目录。本任务未修改页面、现有 enrichment、营业信息或携宠政策。

| 场馆 | 图片 | 授权与作者 | 导航点 |
| --- | --- | --- | --- |
| 上海动物园 | 入口牌石（2016）、园内湖景（2015） | SSYoung，CC BY-SA 4.0；Esin Üstün，CC BY 2.0 | 腾讯地图匹配虹桥路2381号，GCJ-02 31.192683,121.363192；场所参照，非入口 |
| 上海自然博物馆 | 北京西路新馆完整建筑外观（2015） | SSYoung，CC BY-SA 4.0 | 腾讯地图匹配北京西路510号，GCJ-02 31.234992,121.462650；新馆场所参照，非入口 |

三张 WebP 均为720×540、quality 75，共197,462字节（牌石94,454，湖景59,302，博物馆43,706）。保留整个画面，等比缩小和压缩，没有裁剪、换色或合成。每张图片均携带原作页、作者、许可链接、修改说明和历史拍摄年份；CC BY-SA派生文件沿用原许可。湖景仅用于场所图库，不用于推导坐标或宠物准入。

照片来源：

- <https://commons.wikimedia.org/wiki/File:Shanghai_Zoo_Entrance.JPG>
- <https://commons.wikimedia.org/wiki/File:One_of_the_lakes_in_Shanghai_Zoo_(20995319280).jpg>
- <https://commons.wikimedia.org/wiki/File:Shanghai_Natural_History_Museum_(New)_03.JPG>

坐标来源：

- <https://map.qq.com/poi/?sm=6565845323852952734&keyfrom=1>
- <https://map.qq.com/poi/?sm=8040070663151985535&keyfrom=1>

Commons元数据由本子任务实际调用公开API获取，并保存原始响应；三张实际下载的缩略图已目检。腾讯坐标由根任务实际打开POI核验名称、门牌及周边链接的where参数后传回，未声称子任务独立打开了腾讯页面。原始参数顺序为经度、纬度，腾讯GCJ-02坐标未再转换。

Wikidata Q1312291给出的自然博物馆坐标与北京西路新馆不符，没有导入。长风公园的坐标不能替代长风海洋世界，也没有导入或给海洋世界配上公园图。

完整许可字段、下载地址、图片尺寸、SHA-256及未采信来源见 `2026-09-30-new-venue-enrichment-evidence.json`；压缩文件核对见 `2026-09-30-new-venue-image-files.json`。
