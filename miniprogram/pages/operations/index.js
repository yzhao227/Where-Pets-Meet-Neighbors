const s = require('../_shared');
function count(value, limited) { return Number.isFinite(value) && value >= 0 ? (limited && value >= 100 ? '至少 ' : '') + value : '未取得'; }
function date(value) { return typeof value === 'number' && value > 0 ? s.dateText(value) : '尚无记录'; }
s.register({
  data: { loading: true, error: '', mode: '', isAdmin: false, configurations: [], queues: [], maintenance: null, countsLimited: false },
  onLoad() { this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { return s.load(this, async () => {
    const boot = await s.api.call('bootstrap');
    if (!boot.user.isAdmin) return { mode: boot.mode, isAdmin: false, configurations: [], queues: [], maintenance: null };
    const health = await s.api.call('getHealth');
    const demo = health.mode === 'demo';
    const maintenance = health.maintenance || {};
    const configurations = [
      { name: '运营主体与正式政策', value: health.policyConfigured },
      { name: '手机号核验', value: health.phoneEnabled },
      { name: '图片审核', value: health.uploadsEnabled },
      { name: '维护入口', value: health.maintenanceEnabled }
    ].map(item => ({ name: item.name, ready: !demo && item.value === true, label: demo ? '未连接云端' : item.value === true ? '已配置' : item.value === false ? '待配置' : '未取得状态' }));
    return { mode: health.mode, isAdmin: true, configurations, countsLimited: health.countsLimited === true,
      queues: [{ name: '待发送通知', value: count(health.pendingNotifications, health.countsLimited) }, { name: '待处理图片', value: count(health.pendingUploads, health.countsLimited) }, { name: '访问频率记录', value: count(health.rateLimitRecords, health.countsLimited) }],
      maintenance: { lastRun: date(maintenance.lastRunAt), lastSuccess: date(maintenance.lastSuccessAt), failed: !!maintenance.lastErrorCode, result: demo ? '本机演示没有执行云端维护' : maintenance.lastErrorCode ? '最近维护未完成，请检查服务端记录' : maintenance.lastSuccessAt ? '已记录成功维护' : '尚无成功维护记录', errorCode: maintenance.lastErrorCode || '' } };
  }); }
});
