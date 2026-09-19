// Builds the Windows installer: node build.mjs
// The version comes from ../package.json. The release workflow uploads the build to GitHub Releases, where
// installed apps look for updates. SIMC_LAB_UPDATE_URL and SIMC_LAB_DIST
// make a test build that updates from a local folder served by serve-release.mjs instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import {build,Platform,Arch} from 'electron-builder';

const here=import.meta.dirname;
const root=path.resolve(here,'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const release=JSON.parse(await fs.readFile(path.join(here,'release.json'),'utf8'));
const local=process.env.SIMC_LAB_UPDATE_URL,output=process.env.SIMC_LAB_DIST||'dist';
const pkgFile=path.join(here,'package.json');
const pkg=JSON.parse(await fs.readFile(pkgFile,'utf8'));
if(pkg.version!==version){pkg.version=version;await fs.writeFile(pkgFile,JSON.stringify(pkg,null,2)+'\n');}

await build({
  targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),
  projectDir:here,
  publish:process.env.PUBLISH==='always'?'always':'never',
  config:{
    appId:'com.mythicpersona.simclab',
    productName:'SimC Lab',
    copyright:'Copyright © Roburmaster. GPL-3.0-or-later.',
    directories:{output,buildResources:'build'},
    files:['main.cjs','preload.cjs','package.json','build/icon.png'],
    // The server runs as plain Node files next to the app, not inside the asar archive. The WoW addon ships
    // beside it, so every app update carries the matching addon.
    extraResources:[{from:root,to:'server',filter:['server.mjs','package.json','lib/**/*','public/**/*','addon/SimCLab/**/*']},{from:path.join(root,'LICENSE'),to:'LICENSE'}],
    // A fixed file name gives the website a download link that always points at the newest release.
    win:{icon:'build/icon.ico',artifactName:'SimC-Lab-Setup.${ext}'},
    nsis:{installerIcon:'build/icon.ico',uninstallerIcon:'build/icon.ico',license:path.join(root,'LICENSE'),oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'SimC Lab',deleteAppDataOnUninstall:false},
    publish:[local?{provider:'generic',url:local}:{provider:'github',owner:release.owner,repo:release.repo,releaseType:'release'}]
  }
});
console.log(`Built SimC Lab ${version} (updates from ${local||`github.com/${release.owner}/${release.repo}`}): ${path.join(here,output)}`);
