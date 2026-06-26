import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import mammoth from 'mammoth'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OcrInput, OcrResult } from '../ocr.types'
import { declaredZipUncompressedSize } from '../util/zipInflationGuard.util'

// mammoth inflates the whole DOCX in memory. Bound that BEFORE it runs (CWE-409):
// reject a DOCX whose ZIP central directory declares an oversized uncompressed
// total, AND reject one whose CD can't be parsed at all (fail closed — an
// unparseable CD can't be trusted to bound anything). A crafted ZIP with a VALID
// but lying central directory can still under-declare; fully bounding that
// residual requires out-of-process OCR with a memory limit (tracked as a
// follow-up). 100 MB is generous for real documents and far below a bomb.
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
    // Fail CLOSED on an unparseable central directory (null): a DOCX whose ZIP
    // CD is corrupt or crafted to hide its sizes must be rejected, not handed to
    // mammoth — its zip library still inflates entries from their local headers,
    // delivering the bomb the size cap exists to stop.
    if (declared === null) {
      throw new BadRequestException('docx_invalid_zip_structure')
    }
    if (declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
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
