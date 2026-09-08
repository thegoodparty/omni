import { Module } from '@nestjs/common'
import { ContactNoteService } from './services/contactNote.service'
import { ContactNoteVolunteerAccessService } from './services/contactNoteVolunteerAccess.service'

@Module({
  providers: [ContactNoteService, ContactNoteVolunteerAccessService],
  exports: [ContactNoteService, ContactNoteVolunteerAccessService],
})
export class ContactNoteModule {}
