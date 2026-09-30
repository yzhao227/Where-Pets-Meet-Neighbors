# 附近页动作精简与直接跳转 v8

日期：2026-09-30。本轮为本地代码更新，未上传、部署或发布微信版本。

## 结果

1. 我的地点移除「我的纠错」，保留地点收藏、到访记录；旧 type=corrections 路由回到收藏，原纠错记录及运营处理不删除。
2. 详情移除查看距离及参照选择面板，地址行和底部统一导航。附近列表原有位置参照、直线距离和距离排序保持。
3. 资料、参与原文、图片来源及许可链接改为直接打开，不写剪贴板、不弹复制说明。微信端按实际文章 API 或已验证业务域名能力展示可打开按钮。
4. 出门灵感用明确来源、准入信息的候选补足 4 张；当前展示上海动物园、韩湘水博园、上海自然博物馆、兰香湖，另有 16 处可继续探索。数量充足时最多 6 张，检索和筛选不受精选门槛限制。
5. 无坐标地点在浏览器预览中直接打开地图地点搜索；微信云端新增公开地点 ID → 可靠地址解析 → wx.openLocation。无地址不启用导航。
6. 修复浏览器从地图或原文返回时丢失顶部返回入口的问题，历史栈丢失时仍可回到附近。

## 实际浏览器验证

- 我的地点仅显示收藏与到访；详情没有查看距离或复制地址按钮。
- 两列各两张，共 4 张卡片，无第三张后留下的整卡空位。
- 兰香湖无预置坐标：导航直接进入腾讯地图，出现上海市内结果「兰香湖」，地址为闵行区星乐路。
- 上海动物园有核实坐标：直接打开地图标记 31.192683,121.363192，信息窗为上海动物园、虹桥路 2381 号。
- 兰香湖参考原文直接打开新浪承载的上观新闻《可以带“毛孩子”去哪里撒欢？看这篇→》，未复制链接。
- 地图返回详情后，顶部返回按钮可回到附近；无用户定位请求。

## 自动验证

`node --test tests/nearby-*.test.js tests/place-*.test.js tests/neighbor-pages.test.js tests/public-links.test.js tests/preview-*.test.js tests/map-geocoder.test.js tests/cloud-community.test.js tests/deployment.test.js`

结果：291 / 291 通过。包含公开地点解析、精度/城市校验、退出与并发响应、原文域名限制、返回栈、已有地点/用户交互、部署配置往返等。

- `npm run check`：29 个页面通过，主包 1956.8 KiB。
- `npm run check:wechat`：微信官方离线编译通过，29 个 WXML、30 份 WXSS。不是微信模拟器或真机运行验收。

## 微信端仍待配置

- 当前公开配置为 demo，cloudEnv 为空。地址解析代码虽已完成，尚未调用真实地图 API；需部署 community 并在服务端设置 TENCENT_MAP_KEY，之后做真机验收。已有可靠坐标的导航不依赖此 Key。
- 微信 web-view 官方文档明确个人类型小程序暂不支持；普通第三方网页还受业务域名限制，不能通过填入域名绕过。公众号文章可使用官方文章 API（基础库 3.4.8 起），本轮已接入但未真机调用。
- 来源及所需图片许可保持可查；暂不可打开的普通网页在微信端不渲染假跳转按钮。

完整接入说明：[附近导航与原文跳转](../../docs/14-附近导航与原文跳转.md)。本轮未读取 .env.local，未更改实际云配置、账号、草稿、报名或地点数据。

## 官方文档（实际打开核实）

- https://lbs.qq.com/service/webService/webServiceGuide/address/Geocoder
- https://lbs.qq.com/webApi/uriV1/uriGuide/uriWebPoisearch
- https://developers.weixin.qq.com/miniprogram/dev/api/navigate/wx.openOfficialAccountArticle.html
- https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html
