// Editorial itinerary suggestions based on linked public place records.
// Durations are suggested stays, not measured journeys or on-site verification.
const notice = '编辑路线建议 · 未实地核验。停留时间为预计，地点间交通另计；请按当天开放、天气和体力调整。';
module.exports = [
  {
    id: 'guide-xinzhuang-half-day', title: '莘庄半日：公园到商场', shortTitle: '莘庄半日',
    summary: '先看一段绿意，再找地方坐坐。不带宠，也能过一个轻松的半天。',
    duration: '预计停留 2—3 小时', petLabel: '不带宠安排', checkedAt: '2026-09-30', notice,
    conditions: ['先确认莘城中央公园当天开放；旧资料曾标注未向宠物开放，本路线按不带宠安排。',
      '仲盛过往的宠物主题月不代表今天有活动；想逛的商户与营业时间需单独确认。',
      '两地之间按地图选择当日可通行路线，停留时间不包含交通。'],
    steps: [
      { placeId: 'place-xincheng-central', duration: '建议停留 45—60 分钟', action: '从莘城中央公园开始，沿开放园路散步、看树，在允许停留的区域休息；不把季节景色作为当天保证。' },
      { placeId: 'place-zhongsheng', duration: '建议停留 60—90 分钟', action: '前往仲盛世界商城，从南下沉广场了解当天开放的店铺，再按自己的需要用餐或休息；消费另计。' }
    ]
  },
  {
    id: 'guide-lake-pet-break', title: '湖畔遛宠：绿道到外摆', shortTitle: '湖畔遛宠',
    summary: '在兰香湖牵绳走走，再按门店当天安排，到紫竹半岛的外摆区域歇脚。',
    duration: '预计停留 1.5—2.5 小时', petLabel: '仅已注明的户外区域', checkedAt: '2026-09-30', notice,
    conditions: ['行前分别确认兰香湖环湖绿道开放与紫竹半岛星巴克外摆的携宠、座位安排。',
      '全程牵引、主动避让并清理排泄物，准备饮水；遇高温、降雨或宠物不适时缩短行程。',
      '只涉及绿道及门店外摆，不延伸到周边建筑或店内；两地不是已核实的连通步道，交通需自行合规安排。'],
    steps: [
      { placeId: 'place-lanxiang-lake', duration: '建议停留 45—75 分钟', action: '从星乐路附近的兰香湖环湖绿道安排起点，先看现场公告，再选一段允许通行的路线往返；不指定未经核实的入口，也不要求走完整圈。' },
      { placeId: 'place-starbucks-zizhu', duration: '建议停留 30—60 分钟', action: '出发前向紫竹半岛店确认外摆开放与携宠条件，再安排转场。到店仅在获准的外摆区域休息，座位与消费以门店当日安排为准。' }
    ]
  },
  {
    id: 'guide-nature-without-pet', title: '自然观察：绿意到动物园', shortTitle: '不带宠看自然',
    summary: '从中山公园的散步开始，再去上海动物园安静观察野生动物。',
    duration: '预计停留 3—4 小时', petLabel: '不带宠安排', checkedAt: '2026-09-30', notice,
    conditions: ['中山公园现行携宠政策及上海动物园携宠规则均未核实，本路线按不带宠安排。',
      '先核对动物园当季售票入园时间、票务与临时公告；成人票公开价格为40元，其他票种另查。',
      '动物园停车位紧张，官方建议公共交通；可参考10号线上海动物园站1号出口，其他转乘按地图实时安排。',
      '不安排喂食、触摸或宠物互动，不根据动物数量保证当天可见的种类。'],
    steps: [
      { placeId: 'place-zhongshan-park', duration: '建议停留 30—45 分钟', action: '从长宁路780号的中山公园开始，按现场开放范围走一小段园路，给后续参观保留体力。' },
      { placeId: 'place-shanghai-zoo', duration: '建议停留 2—3 小时', action: '提前留出两地交通时间，抵达虹桥路2381号的上海动物园后，按当日园区指引选择展区观察；来不及在入园时段内抵达时，改到另一天参观。' }
    ]
  }
];
