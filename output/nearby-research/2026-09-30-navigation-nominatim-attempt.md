# 公开地图坐标查询未完成记录

记录时间：2026-09-30 19:44:54（Asia/Shanghai，UTC+08:00）。此时间为结果整理时间，不是成功查阅来源的时间。

## 查询范围

计划依次核验以下上海地点，只在地点名称、上海行政区及地址匹配后采用 Nominatim 返回的 WGS84 坐标：

- 莘城中央公园，闵行区闵城路 180 号。
- 力波公园，闵行区虹梅南路、益梅路转角。
- 海粟公园，长宁区凯旋路、延安路附近。
- 古北市民公园，长宁区，具体入口待确认。

## 请求配置

公开接口：`https://nominatim.openstreetmap.org/search`

查询词依次为 `莘城中央公园 上海市`、`力波公园 上海市`、`海粟公园 上海市`、`古北市民公园 上海市`。

其余参数：`format=jsonv2`、`addressdetails=1`、`namedetails=1`、`limit=5`、`countrycodes=cn`。

User-Agent：`YouChongYouLin/0.4.0 (public place coordinate verification)`。

顺序请求，计划请求间隔 1.1 秒，单次超时 25 秒。

## 实际结果

1. 沙箱内首次请求在解析主机名时失败：`urllib.error.URLError: [Errno 8] nodename nor servname provided, or not known`。
2. 已按正式权限流程使用 `require_escalated` 重试。首次请求连接超时：`urllib.error.URLError: <urlopen error timed out>`。进程退出码为 1。
3. 两轮都在首条“莘城中央公园 上海市”请求中止；其余三个地点没有发出请求。
4. 未收到任何 HTTP/JSON 响应，没有可保存的公开地图响应正文，也没有取得或验证任何坐标。

这是网络访问失败，不代表地点不存在，也不代表接口搜索无结果。本次没有修改业务目录数据，没有将摄影位置、湖中心或未经核验的坐标用作导航目的地。主任务继续通过浏览器核验来源。
