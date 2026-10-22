const s = require('../_shared');
const PERSONAL_POLICIES = {
  terms: [
    { title: '1. 服务内容', text: '有宠有邻当前提供宠物档案、私人图文记录、收藏与到访记录，以及整理自公开来源的地点和活动资讯。私人记录仅供你在当前设备查看，不提供用户公开发布、评论、关注、私聊或群组交流。' },
    { title: '2. 本机资料', text: '请保管好自己的设备。个人资料、宠物照片、私人记录和收藏保存在当前设备，当前不提供云端同步。清除小程序数据、移除本机文件或更换设备可能导致记录无法找回。' },
    { title: '3. 地点与活动信息', text: '开放时间、费用、预约及携宠要求以场所或主办方最新公告为准。目录提供资料出处；你需要自行通过主办方的官方渠道确认参与安排。小程序不提供活动报名、收款或票务交易。' },
    { title: '4. 使用与反馈', text: '请合法使用文字和照片，并尊重他人的隐私与权益。你可以在相应记录中编辑或删除内容，在“我的”中清除个人资料和内容。使用问题及个人信息处理请求可通过本页联系方式反馈。' }
  ],
  privacy: [
    { title: '1. 你填写的资料', text: '你填写的昵称、生活片区、个人备注，以及宠物名字、种类、品种、生日或年龄，用于本机档案和私人记录。除必要的记录内容外，其他资料可不填写；这些资料不向其他用户展示。' },
    { title: '2. 你选择的照片', text: '只有在你主动添加时，才调用系统选择照片。所选文件用于宠物档案或私人记录，并保存在当前设备，不用于公开发布。当前不提供云端备份，请勿将小程序作为重要文件的唯一存储位置。' },
    { title: '3. 可选的位置信息', text: '只有在你主动使用距离参照或地图功能时，才按功能需要请求微信定位或地图能力。参照地点用于计算到目的地的直线距离并保存在本机，可更换或清除。不开启定位，也可浏览地点资料并使用已核实的目的地导航；不展示用户住宅距离。' },
    { title: '4. 公开图片和外部页面', text: '浏览精选地点和活动时，可能向公开图片的托管服务请求图片。打开资料链接或地图后，相应服务会按其隐私规则处理访问与导航信息。小程序不会将你的私人记录、宠物档案或收藏主动发送给这些页面。' },
    { title: '5. 保存与删除', text: '个人资料、私人记录、收藏和到访备注保存在当前设备。你可在对应页面编辑、删除，或通过“我的”清除本版本的个人资料和内容；历史社区版本的数据隔离保留。清理小程序存储、删除本机文件或更换设备后，本机数据无法自动恢复。' },
    { title: '6. 联系开发者', text: '如需咨询个人信息查阅、更正、删除或投诉，可通过本页联系方式联系开发者。请说明问题和需要协助的事项，无需发送身份证件、密码或其他无关的敏感信息。' }
  ]
};
s.register({
  data: { loading: true, error: '', type: 'terms', mode: '', isDraft: true, version: '', operatorName: '', contact: '', sections: [], contentMissing: true },
  onLoad(options) { s.safe(this, { type: options.type === 'privacy' ? 'privacy' : 'terms' }); this.refresh(); },
  refresh() {
    const type = this.data.type;
    return s.load(this, async () => {
      const result = await s.api.call('getPolicies');
      const operator = result.operator || {};
      const sections = s.personalMode ? PERSONAL_POLICIES[type] : (Array.isArray(result[type]) ? result[type] : []).filter(section => section && typeof section.title === 'string' && typeof section.text === 'string');
      const version = type === 'privacy' ? result.privacyVersion : result.termsVersion;
      const configuredContact = typeof operator.contact === 'string' && !/本机体验|暂未连接/.test(operator.contact) ? operator.contact : '';
      const operatorName = typeof operator.name === 'string' && !/本机演示|未配置/.test(operator.name) ? operator.name : '';
      return { mode: result.mode, isDraft: !s.personalMode && (result.mode === 'demo' || result.isDraft !== false), operatorName: s.personalMode ? operatorName : operator.name || '',
        contact: s.personalMode ? configuredContact || '13122197119@163.com' : operator.contact || '', version: version || (s.personalMode ? '2026-10-14' : '待配置'), sections, contentMissing: !sections.length };
    });
  },
  selectType(e) { s.safe(this, { type: e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'terms' }); this.refresh(); },
  copyContact() { if (this.data.contact) wx.setClipboardData({ data: this.data.contact }); }
});
