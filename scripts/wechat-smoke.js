'use strict';

// Run in a real WeChat developer-console session after normal phone onboarding.
// No test identity, administrator flag or phone number is sent by this helper.
async function runWechatSmoke(platform, { step, postId } = {}) {
  if (!platform || !platform.cloud || platform.__preview) throw new Error('请在连接真实云环境的微信开发者工具中运行');
  async function call(action, payload = {}) {
    const response = await platform.cloud.callFunction({ name: 'community', data: { action, payload } });
    const result = response && response.result;
    if (!result || !result.ok) throw new Error(result && result.error && result.error.message || '微信联调调用失败');
    return result.data;
  }
  const boot = await call('bootstrap');
  if (boot.mode !== 'cloud' || !boot.user || !boot.user.verification || boot.user.verification.status !== 'phone_verified') throw new Error('请先使用正常页面完成该账号的真实手机号核验');
  if (step === 'publish') {
    const circle = boot.circles && boot.circles[0];
    if (!circle) throw new Error('管理员需先初始化真实社区');
    if (!circle.isJoined) await call('joinCircle', { id: circle.id, join: true });
    const { post } = await call('createPost', { circleId: circle.id, title: '有宠有邻部署联调', text: '这是一条明确标记的部署测试内容，用于验证两个微信账号之间的交流，验收后删除。', images: [] });
    return { step, postId: post.id, next: '在另一个已核验的微信账号执行 reply，并传入此 postId。' };
  }
  if (!postId || typeof postId !== 'string') throw new Error('请提供发布步骤返回的 postId');
  const detail = await call('getPost', { id: postId });
  if (detail.post.title !== '有宠有邻部署联调') throw new Error('只操作本工具明确标记的部署测试帖子');
  if (step === 'reply') {
    if (detail.post.isMine) throw new Error('回复步骤需要第二个微信账号');
    const { comment } = await call('addComment', { targetType: 'post', targetId: postId, text: '第二个微信账号已读到帖子并成功回应。' });
    return { step, postId, commentId: comment.id, next: '返回发布账号执行 verify，确认跨账号评论及站内通知。' };
  }
  if (!detail.post.isMine) throw new Error('验证及清理步骤只能由发布测试帖的账号执行');
  if (step === 'verify') {
    const comments = detail.comments || [];
    const messages = (await call('listMessages')).items || [];
    const commentReceived = comments.some(comment => !comment.isMine);
    const notificationReceived = messages.some(message => message.targetId === postId);
    if (!commentReceived || !notificationReceived) throw new Error('尚未同时读到另一账号评论与通知，请先完成回复并重试');
    return { step, postId, commentReceived, notificationReceived, next: '检查页面效果后执行 cleanup 删除部署测试内容。' };
  }
  if (step === 'cleanup') { await call('deletePost', { id: postId }); return { step, deleted: true }; }
  throw new Error('step 必须为 publish/reply/verify/cleanup');
}
if (typeof module !== 'undefined') module.exports = { runWechatSmoke };
