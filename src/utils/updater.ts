import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export async function checkForUpdates(): Promise<boolean> {
  try {
    console.log('正在检查更新...');
    const update = await check();

    if (update?.available) {
      console.log(`发现新版本: ${update.version}`);
      console.log(`当前版本: ${update.currentVersion}`);
      console.log('更新内容:', update.body);

      // 显示更新对话框
      const shouldUpdate = confirm(
        `发现新版本 ${update.version}\n\n更新内容:\n${update.body}\n\n是否立即更新？`
      );

      if (shouldUpdate) {
        console.log('开始下载更新...');
        
        // 下载并安装更新
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              console.log(`开始下载，总大小: ${event.data.contentLength} 字节`);
              break;
            case 'Progress':
              console.log(`下载进度: ${event.data.chunkLength} 字节`);
              break;
            case 'Finished':
              console.log('下载完成');
              break;
          }
        });

        console.log('更新安装完成，准备重启应用...');
        
        // 重启应用以应用更新
        await relaunch();
        return true;
      }
    } else {
      console.log('当前已是最新版本');
    }
    
    return false;
  } catch (error) {
    console.error('检查更新失败:', error);
    return false;
  }
}

export async function checkForUpdatesSilent() {
  try {
    const update = await check();
    
    if (update?.available) {
      return {
        available: true,
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body,
        date: update.date,
      };
    }
    
    return {
      available: false,
    };
  } catch (error) {
    console.error('检查更新失败:', error);
    return {
      available: false,
      error: String(error),
    };
  }
}

export async function manualCheckUpdate() {
  try {
    const update = await check();

    if (update?.available) {
      const shouldUpdate = confirm(
        `发现新版本 ${update.version}\n\n更新内容:\n${update.body}\n\n是否立即更新？`
      );

      if (shouldUpdate) {
        // 创建进度提示
        const progressDiv = document.createElement('div');
        progressDiv.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 20px 40px;
          border-radius: 8px;
          z-index: 10000;
          font-family: sans-serif;
        `;
        progressDiv.textContent = '正在下载更新...';
        document.body.appendChild(progressDiv);

        try {
          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                progressDiv.textContent = '开始下载更新...';
                break;
              case 'Progress':
                progressDiv.textContent = '正在下载更新...';
                break;
              case 'Finished':
                progressDiv.textContent = '下载完成，准备重启...';
                break;
            }
          });

          await relaunch();
        } finally {
          document.body.removeChild(progressDiv);
        }
      }
    } else {
      alert('当前已是最新版本！');
    }
  } catch (error) {
    console.error('更新失败:', error);
    alert(`更新失败: ${error}`);
  }
}