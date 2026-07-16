import { Module } from '@nestjs/common'
import { ContactNoteService } from './services/contactNote.service'

@Module({
  providers: [ContactNoteService],
  exports: [ContactNoteService],
})
export class ContactNoteModule {}
