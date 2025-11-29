// 此文件由ai生成
const fs = require('fs');
const https = require('https');

const GITEE_OWNER = process.env.GITEE_OWNER;
const GITEE_REPO = process.env.GITEE_REPO;
const TAG_NAME = process.env.TAG_NAME;

async function fetchGiteeRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gitee.com',
      path: `/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/tags/${TAG_NAME}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Failed to fetch release: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function generateUpdaterJson() {
  try {
    console.log('📦 生成 Gitee 更新清单...');
    
    const release = await fetchGiteeRelease();
    console.log(`✅ 获取到 Release: ${release.name}`);
    
    const platforms = {};
    
    // 处理 Windows 平台的安装包
    for (const asset of release.assets) {
      const name = asset.name;
      console.log(`📄 处理文件: ${name}`);
      
      // Windows MSI
      if (name.endsWith('.msi') && !name.includes('.zip')) {
        const sigAsset = release.assets.find(a => a.name === `${name}.sig`);
        if (sigAsset) {
          // 获取签名内容
          const sigResponse = await fetch(sigAsset.browser_download_url);
          const signature = await sigResponse.text();
          
          platforms['windows-x86_64'] = {
            signature: signature.trim(),
            url: asset.browser_download_url
          };
          console.log(`✅ Windows 平台配置完成`);
        }
      }
    }
    
    const version = TAG_NAME.replace('v', '');
    
    const updaterJson = {
      version: version,
      notes: release.body || '更新内容请查看 Release 页面',
      pub_date: release.created_at,
      platforms
    };
    
    fs.writeFileSync('latest.json', JSON.stringify(updaterJson, null, 2));
    console.log('✅ 成功生成 latest.json (Gitee 版本)');
    console.log(JSON.stringify(updaterJson, null, 2));
    
  } catch (error) {
    console.error('❌ 生成更新文件失败:', error);
    process.exit(1);
  }
}

// 添加 fetch polyfill for Node.js
global.fetch = function(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      resolve({
        text: () => new Promise((resolve) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        })
      });
    }).on('error', reject);
  });
};

generateUpdaterJson();