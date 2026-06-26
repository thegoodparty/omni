import { Module } from '@nestjs/common'
import { generateObject, generateText, streamText } from 'ai'
import {
  ANTHROPIC_PROVIDER_FACTORY_TOKEN,
  defaultAnthropicProviderFactory,
  GENERATE_OBJECT_TOKEN,
  GENERATE_TEXT_TOKEN,
  LlmService,
  STREAM_TEXT_TOKEN,
} from './services/llm.service'

@Module({
  providers: [
    LlmService,
    { provide: STREAM_TEXT_TOKEN, useValue: streamText },
    { provide: GENERATE_TEXT_TOKEN, useValue: generateText },
    { provide: GENERATE_OBJECT_TOKEN, useValue: generateObject },
    {
      provide: ANTHROPIC_PROVIDER_FACTORY_TOKEN,
      useValue: defaultAnthropicProviderFactory,
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}
