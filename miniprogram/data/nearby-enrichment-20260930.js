// Verified public scene photographs and venue reference points, checked 2026-09-30.
// Photos retain individual attribution; venue points are not verified entrances.
module.exports = {
  'place-shanghai-zoo': {
    point: {
      latitude: 31.192683,
      longitude: 121.363192,
      coordinateSystem: 'gcj02',
      precision: 'venue',
      label: '上海动物园（虹桥路场所参照，非入口）',
      sourceUrl: 'https://map.qq.com/poi/?sm=6565845323852952734&keyfrom=1'
    },
    photo: {
      url: '/assets/nearby/shanghai-zoo-entrance.webp',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Shanghai_Zoo_Entrance.JPG',
      license: 'CC BY-SA 4.0 · 等比缩小、压缩并转为 WebP',
      credit: 'SSYoung / Wikimedia Commons',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      caption: '上海动物园入口标识实景 · 2016年拍摄，非当前入口指引'
    },
    photos: [{
      url: '/assets/nearby/shanghai-zoo-lake.webp',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:One_of_the_lakes_in_Shanghai_Zoo_(20995319280).jpg',
      license: 'CC BY 2.0 · 等比缩小、压缩并转为 WebP',
      credit: 'Esin Üstün / Wikimedia Commons',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
      caption: '上海动物园园内湖景 · 2015年拍摄，非携宠区域指引'
    }],
    highlights: [
      '官网介绍园内有约470种野生动物；本页收录自然观察场所，不提供宠物接触或互动承诺。',
      '官方参观指南列出地铁10号线上海动物园站1号出口。停车位紧张，园方建议公共交通出行。',
      '所列时间为官网售票及购票游客入园时段，临时安排以当天园方公告为准。',
      '已核实虹桥路2381号的场所参照坐标，具体入园口与当日开放路线请遵循园方指引。'
    ]
  },
  'place-shanghai-natural-history-museum': {
    point: {
      latitude: 31.234992,
      longitude: 121.46265,
      coordinateSystem: 'gcj02',
      precision: 'venue',
      label: '上海自然博物馆（北京西路新馆场所参照，非入口）',
      sourceUrl: 'https://map.qq.com/poi/?sm=8040070663151985535&keyfrom=1'
    },
    photo: {
      url: '/assets/nearby/shanghai-natural-history-museum.webp',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Shanghai_Natural_History_Museum_(New)_03.JPG',
      license: 'CC BY-SA 4.0 · 等比缩小、压缩并转为 WebP',
      credit: 'SSYoung / Wikimedia Commons',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      caption: '上海自然博物馆新馆建筑实景 · 2015年拍摄，非当前入馆安排'
    }
  }
};
