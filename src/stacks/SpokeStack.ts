/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import path from 'path';
import { Aws, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';
import { Layers } from '../constructs/Layers';
import { ResourceExplorerIndex } from '../constructs/ResourceExplorerIndex';
import { StateMachineFromFile } from '../constructs/StateMachineFromFile';
import {NagSuppressions} from "cdk-nag";

export interface SpokeStackProps extends StackProps {
  enabledRegions: string[];
  aggregatorRegion: string;
  bucketName: string | undefined;
  centralRoleArn: string | undefined;

}

export class SpokeStack extends Stack {

  constructor(scope: Construct, id: string, props: SpokeStackProps) {
    super(scope, id, props);
    if (!props.bucketName) {
      throw new Error('Bucket name is required');

    }
    if (!props.centralRoleArn) {
      throw new Error('Central role ARN is required');

    }
    const powerToolsLayer = LayerVersion.fromLayerVersionArn(this, 'powertools', `arn:aws:lambda:${Aws.REGION}:094274105915:layer:AWSLambdaPowertoolsTypeScript:11`);

    const layers = new Layers(this, 'layers');
    //put resources here
    const resourceExplorerIndex = new ResourceExplorerIndex(this, 'MyIndex', {
      layers: layers,
      enabledRegions: props.enabledRegions,
      aggregatorRegion: props.aggregatorRegion,

    });


    const searchFunction = new NodejsFunction(this, 'Search-fn', {
      architecture: Architecture.ARM_64,
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', 'functions', 'Search.ts'),
      handler: 'index.onEvent',
      timeout: Duration.seconds(60),
      layers: [layers.layer, powerToolsLayer],
      initialPolicy: [new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['resource-explorer-2:Search'],
        resources: ['*'],
      })],
      environment: {
        VIEW_ARN: resourceExplorerIndex.viewArn,
        LOG_LEVEL: 'DEBUG',
      },
    });
    const mergeFunction = new NodejsFunction(this, 'MergeResults-fn', {
      architecture: Architecture.ARM_64,
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', 'functions', 'MergeResults.ts'),
      handler: 'index.onEvent',
      timeout: Duration.seconds(60),
      layers: [powerToolsLayer],
      initialPolicy: [],
      environment: {
        LOG_LEVEL: 'DEBUG',
      },
    });

    const stateMachine = new StateMachineFromFile(this, 'SpokeAccountStateMachine',
      { name: 'SpokeAccountStateMachine', file: path.join(__dirname, '..', 'stateMachines', 'SpokeAccountStateMachine.json'), searchFunction: searchFunction, mergeFunction: mergeFunction, putObjectRoleArn: props.centralRoleArn, bucketName: props.bucketName });
    stateMachine.stateMachine.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem', 'dynamodb:UpdateItem'],
      resources: ['*'],


    }));
    stateMachine.stateMachine.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject', 's3:PutObjectAcl'],
      resources: [`arn:aws:s3:::${props.bucketName}`, `arn:aws:s3:::${props.bucketName}/*`],
    }));
    stateMachine.stateMachine.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: [props.centralRoleArn],
    }));
    mergeFunction.grantInvoke(stateMachine.stateMachine);
    searchFunction.grantInvoke(stateMachine.stateMachine);
    const role=new Role(this, 'SchedulerRole', { assumedBy: new ServicePrincipal('scheduler.amazonaws.com') });
    stateMachine.stateMachine.grantStartExecution(role);
    new CfnSchedule(this, 'Scheduler', {
      name: 'TagInventorySchedule',
      flexibleTimeWindow: {
        maximumWindowInMinutes: 60,
        mode: 'FLEXIBLE',
      },
      state: 'ENABLED',
      scheduleExpression: 'rate(1 days)',
      target: {
        arn: stateMachine.stateMachine.stateMachineArn,
        roleArn: role.roleArn,
      },
      scheduleExpressionTimezone: 'America/New_York',
    });
    this.cdkNagSuppressions()
  }

  private cdkNagSuppressions() {
    // NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/S3ServerAccessLogBucket/Resource`, [
    //   {
    //     id: 'AwsSolutions-S1',
    //     reason: 'This is the S3 server access log bucket',
    //   },
    // ]);
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policies acceptable for sample',
      }, {
        id: 'AwsSolutions-ATH1',
        reason: 'Because the lambda is writing to an external table it needs to use client configuration',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions have been scoped down',
      },
    ]);
  }
}