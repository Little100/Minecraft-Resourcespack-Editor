// 此文件由ai生成
const https = require('https');
const fs = require('fs');
const path = require('path');

const GITEE_TOKEN = process.env.GITEE_TOKEN;
const GITEE_OWNER = process.env.GITEE_OWNER;
const GITEE_REPO = process.env.GITEE_REPO;
const TAG_NAME = process.env.TAG_NAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// 从 GitHub 获取 Release 信息
async function getGitHubRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/tags/${TAG_NAME}`,
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
          reject(new Error(`Failed to fetch GitHub release: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// 在 Gitee 创建 Release
async function createGiteeRelease(releaseData) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tag_name: TAG_NAME,
      name: releaseData.name,
      body: releaseData.body,
      prerelease: true,
      target_commitish: 'master'
    });

    const options = {
      hostname: 'gitee.com',
      path: `/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(JSON.parse(data));
        } else {
          console.error('Response:', data);
          reject(new Error(`Failed to create Gitee release: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 上传文件到 Gitee Release
async function uploadAssetToGitee(releaseId, filePath) {
  const FormData = require('form-data');
  const form = new FormData();
  
  form.append('access_token', GITEE_TOKEN);
  form.append('file', fs.createReadStream(filePath));

  return new Promise((resolve, reject) => {
    form.submit({
      protocol: 'https:',
      host: 'gitee.com',
      path: `/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`
    }, (err, res) => {
      if (err) return reject(err);
      
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log(`✅ Uploaded: ${path.basename(filePath)}`);
          resolve(JSON.parse(data));
        } else {
          console.error(`❌ Failed to upload ${path.basename(filePath)}: ${res.statusCode}`);
          console.error('Response:', data);
          reject(new Error(`Upload failed: ${res.statusCode}`));
        }
      });
    });
  });
}

async function main() {
  try {
    console.log('📦 开始同步 Release 到 Gitee...');
    
    // 获取 GitHub Release 信息
    console.log('1️⃣ 获取 GitHub Release 信息...');
    const githubRelease = await getGitHubRelease();
    console.log(`✅ GitHub Release: ${githubRelease.name}`);
    
    // 在 Gitee 创建 Release
    console.log('2️⃣ 在 Gitee 创建 Release...');
    const giteeRelease = await createGiteeRelease(githubRelease);
    console.log(`✅ Gitee Release 创建成功: ${giteeRelease.id}`);
    
    // 上传文件
    console.log('3️⃣ 上传文件到 Gitee...');
    const assetsDir = 'release-assets';
    const files = fs.readdirSync(assetsDir);
    
    for (const file of files) {
      const filePath = path.join(assetsDir, file);
      if (fs.statSync(filePath).isFile()) {
        await uploadAssetToGitee(giteeRelease.id, filePath);
      }
    }
    
    console.log('✅ 所有文件上传完成！');
    console.log(`📍 Gitee Release: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/${TAG_NAME}`);
    
  } catch (error) {
    console.error('❌ 同步失败:', error);
    process.exit(1);
  }
}

main();