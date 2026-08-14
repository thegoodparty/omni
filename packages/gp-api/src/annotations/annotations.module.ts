import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OcrModule } from '@/ocr/ocr.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { AnnotationsController } from './controllers/annotations.controller'
import { BriefingAnnotationsController } from './controllers/briefingAnnotations.controller'
import { OrdinanceAnnotationsController } from './controllers/ordinanceAnnotations.controller'
import { AnnotationsService } from './services/annotations.service'
import { AnnotationAttachmentService } from './services/annotationAttachment.service'

@Module({
  imports: [ElectedOfficeModule, OcrModule, AwsModule, QueueProducerModule],
  controllers: [
    BriefingAnnotationsController,
    OrdinanceAnnotationsController,
    AnnotationsController,
  ],
  providers: [AnnotationsService, AnnotationAttachmentService],
  exports: [AnnotationsService, AnnotationAttachmentService],
})
export class AnnotationsModule {}
