const s = require('../_shared');
s.register({
  data: { loading: true, error: '', mode: '', isAdmin: false, stats: null, types: [] },
  onLoad() { this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { return s.load(this, async () => { const boot = await s.api.call('bootstrap'); if (!boot.user.isAdmin) return { mode: boot.mode, isAdmin: false, stats: null, types: [] }; const stats = await s.api.call('getPetStats'); const labels = [{ id: 'cat', name: '猫', icon: '🐱' }, { id: 'dog', name: '狗', icon: '🐶' }, { id: 'other', name: '其他宠物', icon: '🐾' }]; return { mode: boot.mode, isAdmin: true, stats, types: labels.map(item => Object.assign({}, item, { count: stats.byType[item.id] || 0, percent: stats.profilesWithPet ? Math.round((stats.byType[item.id] || 0) / stats.profilesWithPet * 100) : 0 })) }; }); }
});
