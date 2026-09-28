// The product's identity, in one place for the main process and the build
// scripts. Packaging repeats it in package.json and the electron-builder
// configs; src/test/packaging.test.js keeps them in step.

export const PRODUCT_NAME = 'Append HMI Desktop';
export const PUBLISHER = 'Append Automation';
export const APP_ID = 'com.appendautomation.hmidesktop';

export const WINDOWS_EXE = PRODUCT_NAME + '.exe';
export const LINUX_EXECUTABLE = 'append-hmi-desktop';

// The .ahmi file type: Append HMI Studio owns "open" when it is installed;
// this app adds a "Run" verb, and is the default only without the Studio
export const PROJECT_EXT = 'ahmi';
export const PROG_ID = 'AppendHMIDesktop.Project';
export const RUN_VERB = 'RunWithAppendHMIDesktop';
export const RUN_VERB_LABEL = 'Run with ' + PRODUCT_NAME;

export const HOMEPAGE_URL = 'https://github.com/AppendAutomation/AppendHMIDesktop';
