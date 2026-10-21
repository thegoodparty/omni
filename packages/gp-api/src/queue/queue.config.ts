export const queueConfig = {
  name: process.env.SQS_QUEUE || '',
  queueUrl: `${process.env.SQS_QUEUE_BASE_URL}/${process.env.SQS_QUEUE}`,
  region: process.env.AWS_REGION || '',
}

export const campaignPlanQueueConfig = {
  resultsBucket: process.env.CAMPAIGN_PLAN_RESULTS_BUCKET || '',
}
