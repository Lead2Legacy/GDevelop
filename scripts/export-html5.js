#!/usr/bin/env node
// Short Family fork: headless HTML5 export of a GDevelop project (no editor UI, no cloud).
// Uses the same libGD.js `gd.Exporter` code path as the editor's local HTML5 export
// (newIDE/app/src/ExportAndShare/LocalExporters/LocalHTML5Export.js), with a plain
// Node `fs` file system. Intended as the proof for the "Publish to Lab" path.
//
// Usage: node scripts/export-html5.js <project.json> <outputDir>
// Resource paths in the project are resolved relative to the project file's folder.

const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const appDir = path.join(repoRoot, 'newIDE', 'app');
const gdjsRoot = path.join(appDir, 'resources', 'GDJS');
const initializeGDevelopJs = require(path.join(
  appDir,
  'node_modules',
  'libGD.js-for-tests-only',
  'index.js'
));

const [projectFile, outputDirArg] = process.argv.slice(2);
if (!projectFile || !outputDirArg) {
  console.error('Usage: node scripts/export-html5.js <project.json> <outputDir>');
  process.exit(2);
}
const outputDir = path.resolve(outputDirArg);

const isURL = filename => /^(https?|ftp|blob|data):/.test(filename);
const toPosix = p => p.replace(/\\/g, '/');

(async () => {
  const gd = await initializeGDevelopJs();

  // Minimal AbstractFileSystemJS backed by Node's fs (mirrors LocalFileSystem.js).
  const nodeFileSystem = {
    mkDir: dir => {
      if (isURL(dir)) return true;
      try {
        fs.mkdirSync(dir, { recursive: true });
        return true;
      } catch (e) {
        console.error(`mkDir(${dir}) failed: ${e}`);
        return false;
      }
    },
    dirExists: dir => isURL(dir) || fs.existsSync(dir),
    clearDir: dir => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error(`clearDir(${dir}) failed: ${e}`);
      }
    },
    getTempDir: () => path.join(os.tmpdir(), 'GDTMP-game-maker'),
    fileNameFrom: fullPath => path.basename(fullPath),
    dirNameFrom: fullPath => toPosix(path.dirname(fullPath)),
    makeAbsolute: (filename, baseDirectory) => {
      if (isURL(filename)) return filename;
      return toPosix(path.resolve(baseDirectory, path.normalize(filename)));
    },
    makeRelative: (filename, baseDirectory) => {
      if (isURL(filename)) return filename;
      return toPosix(path.relative(baseDirectory, path.normalize(filename)));
    },
    isAbsolute: fullPath =>
      isURL(fullPath) || fullPath.length === 0 || path.isAbsolute(fullPath),
    copyFile: (source, dest) => {
      try {
        if (source !== dest) fs.cpSync(source, dest);
        return true;
      } catch (e) {
        console.error(`copyFile(${source}, ${dest}) failed: ${e}`);
        return false;
      }
    },
    writeToFile: (file, contents) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
        return true;
      } catch (e) {
        console.error(`writeToFile(${file}) failed: ${e}`);
        return false;
      }
    },
    readFile: file => {
      try {
        return fs.readFileSync(file).toString();
      } catch (e) {
        console.error(`readFile(${file}) failed: ${e}`);
        return '';
      }
    },
    readDir: (dir, ext) => {
      ext = ext.toUpperCase();
      const output = new gd.VectorString();
      try {
        if (fs.existsSync(dir)) {
          fs.readdirSync(dir).forEach(file => {
            if (ext.length === 0 || file.toUpperCase().endsWith(ext)) {
              output.push_back(dir + '/' + file);
            }
          });
        }
      } catch (e) {
        console.error(`readDir(${dir}, ${ext}) failed: ${e}`);
      }
      return output;
    },
    fileExists: filePath => {
      try {
        return fs.statSync(filePath).isFile();
      } catch (e) {
        return false;
      }
    },
  };

  const projectPath = path.resolve(projectFile);
  const serializedProject = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

  const project = gd.ProjectHelper.createNewGDJSProject();
  project.unserializeFrom(gd.Serializer.fromJSObject(serializedProject));
  project.setProjectFile(toPosix(projectPath));

  const fileSystem = Object.assign(new gd.AbstractFileSystemJS(), nodeFileSystem);
  const exporter = new gd.Exporter(fileSystem, toPosix(gdjsRoot));
  const exportOptions = new gd.ExportOptions(project, toPosix(outputDir));

  console.log(
    `Exporting "${project.getName()}" (${project.getLayoutsCount()} scene(s)) -> ${outputDir}`
  );
  const ok = exporter.exportWholePixiProject(exportOptions);
  exportOptions.delete();
  exporter.delete();
  project.delete();

  if (!ok) {
    console.error('exportWholePixiProject returned false');
    process.exit(1);
  }
  console.log('Export OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
