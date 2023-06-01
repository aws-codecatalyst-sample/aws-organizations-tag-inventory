import {awscdk} from 'projen';
import {NodePackageManager} from "projen/lib/javascript";

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.81.0',
  defaultReleaseBranch: 'main',
  name: 'aws-organizations-tag-inventory',
  projenrcTs: true,
 packageManager: NodePackageManager.NPM,
    gitignore: [".idea", "*.iml"]

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();