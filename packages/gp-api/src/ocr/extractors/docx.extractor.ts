import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import mammoth from 'mammoth'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OcrInput, OcrResult } from '../ocr.types'
import { declaredZipUncompressedSize } from '../util/zipInflationGuard.util'

// mammoth inflates the whole DOCX in memory. Reject a DOCX whose ZIP central
// directory DECLARES an oversized uncompressed total — a cheap pre-check that
// catches honest zip-bombs before mammoth runs (CWE-409). A crafted ZIP with a
// lying central directory can under-declare; fully bounding that requires
// out-of-process OCR with a memory limit (tracked as a follow-up). 100 MB is
// generous for real documents (text + embedded media) and far below a bomb.
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

/**
 * DOCX extraction via mammoth. No OCR needed — the bytes are the text.
 */
@Injectable()
export class DocxOcrExtractor {
  constructor(private readonly s3: S3Service) {}

  async extract(input: OcrInput): Promise<OcrResult> {
    const bytes = await this.s3.getFileBytes(input.bucket, input.key)
    if (!bytes) {
      throw new NotFoundException('attachment_object_missing')
    }
    const declared = declaredZipUncompressedSize(bytes)
    if (declared !== null && declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new BadRequestException('docx_decompression_limit_exceeded')
    }
    const result = await mammoth.extractRawText({ buffer: bytes })
    return {
      text: (result.value ?? '').trim(),
      confidence: null,
      meta: {
        extractor: 'mammoth',
        warnings: result.messages?.length ?? 0,
      },
    }
  }
}
