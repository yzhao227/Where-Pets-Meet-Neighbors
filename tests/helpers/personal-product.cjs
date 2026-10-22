// Test-only fixture for the retained personal service and its private UI.
// It never rewrites the shipped configuration or real user storage.
Object.assign(require('../../miniprogram/config'), { productMode: 'personal', mode: 'demo', cloudEnv: '' });
