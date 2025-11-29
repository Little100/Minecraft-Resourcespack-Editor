// 此文件由ai生成
const fs = require('fs');
const https = require('https');

const GITHUB_REPO = 'Little100/Minecraft-Resourcespack-Editor';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
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
    const release = await fetchLatestRelease();
    
    const platforms = {};
    
    // 处理各平台的安装包
    for (const asset of release.assets) {
      const name = asset.name;
      
      // Windows
      if (name.endsWith('.msi') || name.endsWith('.exe')) {
        const sigAsset = release.assets.find(a => a.name === `${name}.sig`);
        if (sigAsset) {
          const sigResponse = await fetch(sigAsset.browser_download_url);
          const signature = await sigResponse.text();
          
          platforms['windows-x86_64'] = {
            signature: signature.trim(),
            url: asset.browser_download_url
          };
        }
      }
      
      // macOS Intel
      if (name.includes('x64') && (name.endsWith('.dmg') || name.endsWith('.app.tar.gz'))) {
        const sigAsset = release.assets.find(a => a.name === `${name}.sig`);
        if (sigAsset) {
          const sigResponse = await fetch(sigAsset.browser_download_url);
          const signature = await sigResponse.text();
          
          platforms['darwin-x86_64'] = {
            signature: signature.trim(),
            url: asset.browser_download_url
          };
        }
      }
      
      // macOS Apple Silicon
      if (name.includes('aarch64') && (name.endsWith('.dmg') || name.endsWith('.app.tar.gz'))) {
        const sigAsset = release.assets.find(a => a.name === `${name}.sig`);
        if (sigAsset) {
          const sigResponse = await fetch(sigAsset.browser_download_url);
          const signature = await sigResponse.text();
          
          platforms['darwin-aarch64'] = {
            signature: signature.trim(),
            url: asset.browser_download_url
          };
        }
      }
      
      // Linux
      if (name.endsWith('.AppImage') || name.endsWith('.deb')) {
        const sigAsset = release.assets.find(a => a.name === `${name}.sig`);
        if (sigAsset) {
          const sigResponse = await fetch(sigAsset.browser_download_url);
          const signature = await sigResponse.text();
          
          platforms['linux-x86_64'] = {
            signature: signature.trim(),
            url: asset.browser_download_url
          };
        }
      }
    }
    
    const updaterJson = {
      version: release.tag_name.replace('v', ''),
      notes: release.body || '更新内容请查看 GitHub Release 页面',
      pub_date: release.published_at,
      platforms
    };
    
    fs.writeFileSync('latest.json', JSON.stringify(updaterJson, null, 2));
    console.log('✅ 成功生成 latest.json');
    console.log(JSON.stringify(updaterJson, null, 2));
    
  } catch (error) {
    console.error('❌ 生成更新文件失败:', error);
    process.exit(1);
  }
}

generateUpdaterJson();