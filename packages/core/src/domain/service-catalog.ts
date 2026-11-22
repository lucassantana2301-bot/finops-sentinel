import type { Provider, ServiceCategory } from './cost-record.js';

/**
 * Classificação de serviços em categorias FOCUS para exports que não trazem ServiceCategory
 * (CUR 2.0 e Cost Details do Azure). Exports FOCUS já vêm com a categoria e não passam por aqui.
 */

const AWS_PRODUCT_CODES: Record<string, { name: string; category: ServiceCategory }> = {
  amazonec2: { name: 'Amazon EC2', category: 'Compute' },
  awslambda: { name: 'AWS Lambda', category: 'Compute' },
  amazonecs: { name: 'Amazon ECS', category: 'Compute' },
  amazoneks: { name: 'Amazon EKS', category: 'Compute' },
  awsfargate: { name: 'AWS Fargate', category: 'Compute' },
  amazons3: { name: 'Amazon S3', category: 'Storage' },
  amazonefs: { name: 'Amazon EFS', category: 'Storage' },
  awsbackup: { name: 'AWS Backup', category: 'Storage' },
  amazonrds: { name: 'Amazon RDS', category: 'Databases' },
  amazondynamodb: { name: 'Amazon DynamoDB', category: 'Databases' },
  amazonelasticache: { name: 'Amazon ElastiCache', category: 'Databases' },
  amazonredshift: { name: 'Amazon Redshift', category: 'Analytics' },
  amazonathena: { name: 'Amazon Athena', category: 'Analytics' },
  awsglue: { name: 'AWS Glue', category: 'Analytics' },
  amazonvpc: { name: 'Amazon VPC', category: 'Networking' },
  awsdatatransfer: { name: 'AWS Data Transfer', category: 'Networking' },
  amazoncloudfront: { name: 'Amazon CloudFront', category: 'Networking' },
  amazonroute53: { name: 'Amazon Route 53', category: 'Networking' },
  awselb: { name: 'Elastic Load Balancing', category: 'Networking' },
  amazonsagemaker: { name: 'Amazon SageMaker', category: 'AI and Machine Learning' },
  amazonbedrock: { name: 'Amazon Bedrock', category: 'AI and Machine Learning' },
  amazoncloudwatch: { name: 'Amazon CloudWatch', category: 'Management and Governance' },
  awscloudtrail: { name: 'AWS CloudTrail', category: 'Management and Governance' },
  awsconfig: { name: 'AWS Config', category: 'Management and Governance' },
  awskms: { name: 'AWS KMS', category: 'Security' },
  awssecretsmanager: { name: 'AWS Secrets Manager', category: 'Security' },
  amazonguardduty: { name: 'Amazon GuardDuty', category: 'Security' },
};

/** Regras por palavra-chave, avaliadas em ordem (a primeira que casar vence). */
const KEYWORD_RULES: ReadonlyArray<readonly [RegExp, ServiceCategory]> = [
  [/openai|cognitive|machine learning|sagemaker|bedrock|ai search/i, 'AI and Machine Learning'],
  [/virtual machine|compute|kubernetes|aks|container|functions|app service|lambda|fargate|batch/i, 'Compute'],
  [/sql|cosmos|database|redis|postgres|mysql|dynamo|cache/i, 'Databases'],
  [/storage|disk|backup|blob|file/i, 'Storage'],
  [/bandwidth|network|gateway|load balanc|dns|front door|cdn|vpn|ip address|traffic/i, 'Networking'],
  [/synapse|data factory|databricks|analytics|event hubs|stream/i, 'Analytics'],
  [/monitor|log analytics|insights|automation|advisor/i, 'Management and Governance'],
  [/key vault|defender|sentinel|security|firewall/i, 'Security'],
];

const compact = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

const AWS_BY_NAME = new Map(Object.values(AWS_PRODUCT_CODES).map((entry) => [compact(entry.name), entry.category]));

export function classifyService(provider: Provider, serviceName: string): ServiceCategory {
  if (provider === 'aws') {
    const key = compact(serviceName);
    const known = AWS_PRODUCT_CODES[key]?.category ?? AWS_BY_NAME.get(key);
    if (known) return known;
  }
  for (const [pattern, category] of KEYWORD_RULES) {
    if (pattern.test(serviceName)) return category;
  }
  return 'Other';
}

/** Converte o product code do CUR (AmazonEC2) no nome amigável (Amazon EC2). */
export function awsServiceName(productCode: string): string {
  return AWS_PRODUCT_CODES[compact(productCode)]?.name ?? productCode;
}
