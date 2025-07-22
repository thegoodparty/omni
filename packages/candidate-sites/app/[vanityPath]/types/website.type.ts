export type WebsiteTheme = {
  bg: string
  text: string
  accent: string
  accentText: string
  secondary: string
  border: string
  muiColor: string
}

export type Website = {
  id: number
  createdAt: string
  updatedAt: string
  campaignId: number
  status: string
  vanityPath: string
  content: {
    main: {
      image: string
      title: string
      tagline: string
    }
    logo: string
    about: {
      bio: string
      issues: {
        title: string
        description: string
      }[]
      committee: string
    }
    theme: string
    status: string
    contact: {
      email: string
      phone: string
      address: string
    }
  }
  campaign: {
    details: {
      zip: string
      city: string
      tier: number
      level: string
      party: string
      state: string
      county: string
      office: string
      raceId: string
      pledged: boolean
      electionId: string
      hasPrimary: boolean
      positionId: string
      ballotLevel: string
      otherOffice: string
      electionDate: string
      partisanType: string
      filingPeriodsEnd: string
      officeTermLength: number
      filingPeriodsStart: string
      priorElectionDates: string[]
    }
    user: {
      firstName: string
      lastName: string
    }
  }
}