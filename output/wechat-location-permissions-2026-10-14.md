# 微信地理位置接口核对（2026-10-14）

## 后台核实结果

实查「开发管理 → 接口设置 → 接口权限」，wx.getLocation 的「暂无权限」问号提示：

> 类目未符合开通条件，请确保小程序具备与实时地理位置强相关的使用场景。

wx.chooseLocation、wx.getFuzzyLocation、wx.choosePoi、wx.chooseAddress 的绿色「开通」为申请入口，并非已获批。当前批量申请表默认勾选四项；填写前应按实际用途选择。此次只读核对，没有提交接口申请或修改后台设置。

## 处理建议

| 接口 | 当前用途和处理 |
| --- | --- |
| chooseLocation | 优先申请。附近页手选公共距离参照；资料页手选居住范围。 |
| getFuzzyLocation | 建议作为自动附近推荐的适配方案，接入代码与声明后申请。模糊位置不用于精确公里数。 |
| getLocation | 当前正在调用，但类目不符。只有真实业务类目与微信开放场景符合并通过审核，才可申请；不能靠修改 app.json 获得后台资格。 |
| onLocationChange / startLocationUpdate / startLocationUpdateBackground | 当前未使用，不申请。 |
| chooseAddress | 收货地址接口，当前无调用，不申请。 |
| choosePoi | 当前无调用，不申请。 |
| openLocation | 已使用公共目的地 GCJ-02 坐标打开地图，不需要先获取访问者 GPS；与 getLocation 资格分开处理。 |

## chooseLocation 申请用途文案

用户主动在地图选择公共地点，作为附近宠物友好地点与活动的距离参照；或在资料页开启居住约距分享后，手选居住范围。居住位置在本机转换为约1公里网格，仅保存网格，双方开启后展示距离范围，不公开住址、原始坐标或提供到人导航。公共距离参照保存在本机，用户可更换或清除。

配图建议：附近页「在地图上选择参照」、地图选点、选点后的距离展示、资料页居住约距开关与用途说明。应使用测试位置，避免上传用户真实住址。

## getFuzzyLocation 申请用途文案（接入后使用）

用户在附近页主动点击定位并授权后，获取模糊地理位置，用于推荐周边宠物友好地点及宠物活动。模糊位置仅作附近推荐参考，不用于展示精确距离或生成居住位置，不进行持续或后台定位；用户也可手动选择公共地点浏览。具体存储与失效方式应与最终实现一致后补充。

## 代码配套事项（本次未修改）

- `miniprogram/services/nearby-location.js` 目前调用 getLocation，并要求精度不大于200米。getFuzzyLocation 不返回 accuracy，不能直接套用现有有效性检查。
- 若采用模糊定位，应同步调整调用、有效性判断、距离与排序展示、app.json 的 requiredPrivateInfos 与 scope.userFuzzyLocation，并按最终功能完成后台隐私声明。
- 公共地点具体直线距离可按用户主动确认的地图参照点计算，明确显示“距所选位置”，不要将手选位置冒充实时所在地。
- app.json 的 scope.userLocation 描述目前仅涵盖公共地点距离，还需纳入手选居住范围。短文案建议：`用于手选地点、居住范围及展示附近距离`。
- 应用内 seed.js 与 cloudfunctions/community/runtime-config.js 的位置说明一致：GPS仅在本机内存保存15分钟；手选公共参照本机保存；住宅位置转换为约1公里网格后保存到私有用户记录，双方开启才展示距离分段。
- 资料页手选居住范围的失败提示应区分平台接口权限与用户拒绝授权。

## 官方依据（2026-10-14实际打开）

- [getLocation：开放类目、接口申请与声明](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.getLocation.html)
- [getFuzzyLocation：模糊位置、scope.userFuzzyLocation](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.getFuzzyLocation.html)
- [chooseLocation：手选位置与申请要求](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.chooseLocation.html)
- [openLocation：使用目的地坐标打开微信内置地图](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.openLocation.html)

本次是权限诊断与申请材料准备，未改运行代码，未开通接口，未上传或发布微信版本。
