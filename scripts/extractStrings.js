const fs = require('fs');
const path = require('path');
const { exit } = require('process');

// Keys to localize. Add new keys here.
const LocKeys = [
  "json",
  "description",
  "label",
  "linkLabel",
  "preText",
  "postText",
  "title",
  "chartTitle",
  "defaultItemsText",
  "loadButtonText",
  "noDataMessage",
  "markDown" // specific to cohorts
];

// For Workbook items that are arrays, these are the following field names that uniquely identify them
const ArrayLocIdentifier = {
  "items": "name",
  "parameters": "id",
  "labelSettings": "columnId",
  "links": "id"
};

const LocalizeableFileExt = [
  "workbook",
  "cohort"
];

const LocalizeableFileType = {
  CategoryResources: 1,
  Settings: 2,
  Template: 3
};

const CategoryResourcesFile = "categoryResources.json";
const SettingsFile = "settings.json";
const LocProjectFileName = "LocProject.json";

const Encoding = 'utf8';
const ResJsonStringFileExtension = '.resjson';
const LCLStringFileExtension = ".resjson.lcl";
const DefaultLang = "en-us";

const WorkbookTemplateFolder = "\\Workbooks\\";
const CohortsTemplateFolder = "\\Cohorts\\";
const RESJSONOutputFolder = "\\output\\loc\\";
const LangOutputSpecifier = "{Lang}";

const ValidParameterNameRegex = "[_a-zA-Z\xA0-\uFFFF][_a-zA-Z0-9\xA0-\uFFFF]*";
const ValidSpecifierRegex = "[_a-zA-Z0-9\xA0-\uFFFF\\-\\$\\@\\.\\[\\]\\*\\?\\(\\)\\<\\>\\=\\,\\:]*";
const ParameterRegex = new RegExp("\{" + ValidParameterNameRegex + "(:" + ValidSpecifierRegex + ")?\}", "g");
const NotAllSpecialCharsRegex = new RegExp("[a-z]+", "i");

// Flag to turn on or off console logs
const LogInfo = true;

/**
 * FUNCTIONS 
 */

/** Enure given path is valid */
function testPath(path) {
  logMessage("Processing template path: " + path);
  if (fs.existsSync(path)) {
    return true;
  } else {
    logError("Template path does not exist: " + path);
    return false;
  }
}

function getWorkbookDirectories(rootDirectory) {
  const workbooksSubDir = rootDirectory.concat(WorkbookTemplateFolder);
  return getDirectoriesRecursive(workbooksSubDir);
}

function getCohortDirectories(rootDirectory) {
  const cohortsSubDir = rootDirectory.concat(CohortsTemplateFolder);
  return getDirectoriesRecursive(cohortsSubDir);
}

function flatten(lists) {
  return lists.reduce((a, b) => a.concat(b), []);
}

function getLocalizeableFileDirectories(directoryPath) {
  const workbooksDirectories = getWorkbookDirectories(directoryPath);
  const cohortsDirectories = getCohortDirectories(directoryPath);
  return (workbooksDirectories || []).concat(cohortsDirectories);
}

function getDirectories(srcpath) {
  return fs.readdirSync(srcpath)
    .map(file => path.join(srcpath, file))
    .filter(path => fs.statSync(path).isDirectory());
}

function getDirectoriesRecursive(srcpath) {
  return [srcpath, ...flatten(getDirectories(srcpath).map(getDirectoriesRecursive))];
}

/** Generates a output path for the template path by replacing template directory with output directory */
function generateOutputPath(dir, folder) {
  var outputPath;
  if (dir.includes(CohortsTemplateFolder)) {
    outputPath = dir.replace(CohortsTemplateFolder, folder);
  } else {
    outputPath = dir.replace(WorkbookTemplateFolder, folder);
  }
  if (!fs.existsSync(outputPath)) {
    const directoryPath = getDirectoryFromPath(outputPath);
    fs.mkdirSync(directoryPath, { recursive: true });
  }
  return outputPath;
}

/** Validates file type as localizeable. Expected to be either workbook/cohort file or settings/categoryjson file. Returns null if file is not localizeable */
function getLocalizeableFileType(fileName) {
  if (fileName.localeCompare(CategoryResourcesFile) === 0) {
    return LocalizeableFileType.CategoryResources;
  } else if (fileName.localeCompare(SettingsFile) === 0) {
    return LocalizeableFileType.Settings;
  }
  var a = fileName.split(".");
  if (a.length === 1 || (a[0] === "" && a.length === 2)) {
    return null;
  }
  const extension = a.pop();
  if (extension && LocalizeableFileExt.includes(extension.toLowerCase())) {
    return LocalizeableFileType.Template;
  }
  return null;
}

function logMessage(message) {
  if (LogInfo) {
    console.log("INFO: ", message);
  }
}

function logError(message, shouldExit) {
  console.error("ERROR: ", message);
  if (shouldExit) {
    exit(1);
  }
}

function openFile(file) {
  try {
    logMessage("Processing file: " + file);
    const data = fs.readFileSync(file, Encoding);
    return data;
  } catch (err) {
    logError("Cannot open file: " + file + " Error: " + err, true);
  }
}

function writeJSONToFile(content, fullPath, exitOnFail) {
  const directory = getDirectoryFromPath(fullPath);
  try {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
    logMessage("Wrote RESJSON file: " + fullPath)
  } catch (e) {
    logError("Cannot write to file: " + fullPath + "Error : " + e, exitOnFail);
  }
}

function getLocalizeableStrings(obj, key, outputMap, templatePath) {
  for (var field in obj) {
    var objectEntry = obj[field];
    var jsonKey;
    if (typeof objectEntry === 'object') {
      // If the last field is a number, it is part of an array.
      // See if there's another identifier such that if a template order is edited, the string does not need to be re-localized
      if (isNumeric(field)) {
        jsonKey = getKeyForArrayObject(key, objectEntry, field);
      } else {
        jsonKey = key.concat(".", field);
      }
      getLocalizeableStrings(objectEntry, jsonKey, outputMap, templatePath);

    } else if (LocKeys.includes(field)) {
      jsonKey = key.concat(".", field).substring(1);
      const jsonVal = obj[field];
      if (canLocalize(jsonVal)) {
        if (outputMap[jsonKey] != null) {
          logError("Found duplicate key: " + jsonKey + " in template: " + templatePath + ". To fix this error, change the step name or id", /**true**/);
          // delete the key from being localized 
          outputMap[jsonKey] = undefined;
        } else {
          outputMap[jsonKey] = jsonVal;
        }
      }
      // Check for parameters that should be locked
      findAndGenerateLockedStringComment(jsonKey, objectEntry, outputMap);
    }
  }
}

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

/** Returns true if string has localizeable text  */
function canLocalize(text) {
  return text !== null && text !== undefined && text !== "" && text.match(NotAllSpecialCharsRegex);
}

/** Gets unique key identifier for array object */
function getKeyForArrayObject(key, objectEntry, field) {
  const identifier = endsWithLocIdentifier(key);
  if (identifier !== "" && objectEntry[ArrayLocIdentifier[identifier]] != null) {
    // remove special characters from the identifier
    return key.concat(".", removeNonAplhaNumeric(objectEntry[ArrayLocIdentifier[identifier]]));
  }
  return key.concat(".", field);
}

function endsWithLocIdentifier(key) {
  const ids = Object.keys(ArrayLocIdentifier);
  for (var i in ids) {
    if (key.endsWith(ids[i])) {
      return ids[i];
    }
  }
  return null;
}

/** Get localizeable strings from category resources file */
function getCategoryResourceStrings(object, outputMap) {
  if (object && object[DefaultLang]) {
    const name = object[DefaultLang].name;
    const description = object[DefaultLang].description;
    outputMap["en-us.name"] = name;
    if (description != "") {
      outputMap["en-us.description"] = description;
    }
  }
}

/** Get localizeable strings from settings file */
function getSettingStrings(object, outputMap) {
  if (object && object.hasOwnProperty("name")) {
    outputMap["settings.name"] = object.name;
  }
}

function removeNonAplhaNumeric(str) {
  return str.replace(/[\W_]/g, "");
}

/** Needed as entry in resjson file to keep parameter names from being translated */
function findAndGenerateLockedStringComment(jsonKey, stringToLoc, outputMap) {
  const params = findParameterNames(stringToLoc);
  const columns = findColumnNameReferences(stringToLoc);

  if (params || columns) {
    const commentKey = "_" + jsonKey + ".comment";
    const commentEntry = "{Locked=" + (params || []).join(",") + (params && columns ? "," : "") + (columns || []).join(",") + "}";
    outputMap[commentKey] = commentEntry;
  }
}

/** Copied from InsightsPortal to find parameters in strings.*/
function findParameterNames(text) {
  var params = null;
  try {
    params = text.match(ParameterRegex);
  } catch (e) {
    logError("Cannot extract parameter. Error: " + e);
  }
  return params;
}

function findColumnNameReferences(text) {
  const ValidColumnNameRegex = '\\[\"' + ".*?" + '\"\\]';
  var _columnRegex = new RegExp(ValidColumnNameRegex, "g");
  var columnRefs = null;
  try {
    columnRefs = text.match(_columnRegex);
  } catch (e) {
    logError("Cannot extract parameter. Error: " + e);
  }
  return columnRefs;
}
/** Returns the directory from full path */
function getDirectoryFromPath(path) {
  return path.substr(0, path.lastIndexOf("\\"));
}

/** Generate LocProject entry for localization tool */
function generateLocProjectEntry(templatePath, resjsonOutputPath, rootDirectory) {
  // For explanations on what each field does, see doc here: https://aka.ms/cdpxloc
  return {
    "SourceFile": resjsonOutputPath.concat(ResJsonStringFileExtension),
    "LclFile": getLocOutputPath(templatePath, LCLStringFileExtension, rootDirectory),
    "CopyOption": "LangIDOnPath",
    "OutputPath": getLocOutputPath(templatePath, ResJsonStringFileExtension, rootDirectory)
  };
}

/** Return output path like root/{Lang}/{TemplateType}/templatePath*/
function getLocOutputPath(templatePath, extensionType, root) {
  const newTemplatePath = templatePath.replace(root, root.concat(root.endsWith("\\") ? "" : "\\", LangOutputSpecifier, root.endsWith("\\") ? "\\" : ""));
  const templateSplit = newTemplatePath.split("\\");
  templateSplit[templateSplit.length - 1] = templateSplit[templateSplit.length - 1].concat(extensionType);
  return templateSplit.join("\\");
}

/** Write string file as RESJSON */
function writeToFileRESJSON(data, outputPath) {
  const fullpath = outputPath.concat(ResJsonStringFileExtension);

  const content = JSON.stringify(data, null, "\t");
  if (content.localeCompare("{}") === 0) {
    logMessage("No strings found for: " + fullpath);
    return;
  }
  writeJSONToFile(content, fullpath, true)
}

function getRootFolder(dir) {
  var root = "";
  if (dir.includes(CohortsTemplateFolder)) {
    root = dir.slice(0, dir.indexOf(CohortsTemplateFolder));
  } else {
    root = dir.slice(0, dir.indexOf(WorkbookTemplateFolder));
  }
  return root;
}

/** Write a LocProject.json file needed to point the loc tool to the resjson files + where to output LCL files  */
function generateLocProjectFile(locItems, directoryPath) {
  logMessage("Generating LocProject.json file");

  const locProjectJson = {
    "Projects": [
      {
        "LanguageSet": "Azure_Languages",
        "LocItems": locItems
      }
    ]
  };
  const content = JSON.stringify(locProjectJson, null, "\t");
  const pathToLocProjectFile = getRootFolder(directoryPath).concat("\\src");
  writeJSONToFile(content, pathToLocProjectFile.concat("\\", LocProjectFileName), true);
  logMessage("Generated LocProject.json file: " + pathToLocProjectFile);
}

function extractStringsFromFile(fileData, fileType, localizeableStrings, templatePath) {
  try {
    const data = JSON.parse(fileData);
    switch (fileType) {
      case LocalizeableFileType.Settings:
        getSettingStrings(data, localizeableStrings);
        break;
      case LocalizeableFileType.CategoryResources:
        getCategoryResourceStrings(data, localizeableStrings);
        break;
      default:
        getLocalizeableStrings(data, "", localizeableStrings, templatePath);
    }
  } catch (e) {
    logError("Failed to process file: " + templatePath + " Error: " + e, true);
  }
}

/**
 * ============================================================
 * SCRIPT MAIN
 * ============================================================
 */

if (!process.argv[2]) { // Path to extract strings from 
  logError("Workbook path not provided. Please provide the path to the workbook folder.", true);
}

if (!process.argv[3]) { // Flag to specify root or test directory
  logError("Please specify if the given directory is root or test. 'root' means the given path is the root directory of the repository. 'test' means the given path is a subdirectory eg. workbook folder with template.", true);
}

const directoryPath = process.argv[2];
const exists = testPath(directoryPath); // Verify directory path
if (!exists) {
  logError("Given script argument directory does not exist", true);
}

// Valid args, start processing the files.
logMessage("Localization extract strings script starting...");

var directories = process.argv[3] === "test" ? [directoryPath] : getLocalizeableFileDirectories(directoryPath);

const locProjectOutput = []; // List of localization file entries for LocProject.json output
var rootDirectory;

for (var d in directories) {
  const templatePath = directories[d];
  if (!rootDirectory) {
    rootDirectory = getRootFolder(templatePath);
  }

  const files = fs.readdirSync(templatePath);
  if (!files || files.length === 0) {
    continue;
  }

  var localizeableStrings = {};

  // This is where we will output the resjson artifact
  const resjonOutputPath = generateOutputPath(templatePath, RESJSONOutputFolder);

  for (var i in files) {
    const fileName = files[i];
    const fileType = getLocalizeableFileType(fileName);
    // If extension type is not valid localizeable file type, skip
    if (!fileType) {
      continue;
    }

    const filePath = templatePath.concat("\\", fileName);

    // Parse the template for localizeable strings
    const fileData = openFile(filePath);
    extractStringsFromFile(fileData, fileType, localizeableStrings, templatePath);

    if (Object.keys(localizeableStrings).length > 0 && !templatePath.endsWith("\\")) {
      // Add LocProject entry
      const locProjectEntry = generateLocProjectEntry(templatePath, resjonOutputPath, rootDirectory);
      locProjectOutput.push(locProjectEntry);

      // Write localizeable strings to file
      writeToFileRESJSON(localizeableStrings, resjonOutputPath);
    }
  }
}

generateLocProjectFile(locProjectOutput, directoryPath.concat("\\"));