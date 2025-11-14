module.exports = {
  apps: [{
    name: 'photo-getter-server',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3003
    },
    max_memory_restart: '1G',
  }]
};
