import { getUserFullName } from '@/app/shared/utils/getUserFullName'
import { Website } from '../types/website.type'
import Image from 'next/image'
import { Link } from 'react-scroll'

export default function WebsiteHeader({
  activeTheme,
  website,
}: {
  activeTheme: any
  website: Website
}) {
  const content = website.content || {}
  const candidate = website.campaign?.user
  return (
    <header className={`p-4 border-b ${activeTheme.border} ${activeTheme.bg}`}>
      <nav className="max-w-6xl mx-auto px-8 flex justify-between items-center">
        <div className="flex-1 min-w-0">
          {content.logo ? (
            <Image
              src={content.logo}
              alt="Campaign Logo"
              height={80}
              width={200}
              className="h-8 max-w-[200px] object-contain object-left"
              priority
            />
          ) : candidate ? (
            <span className={`text-xl font-medium border ${activeTheme.border} rounded-md px-4 py-2 truncate`}>
              {getUserFullName(candidate)}
            </span>
          ) : (
            <Image
              src={'/images/logo/heart.svg'}
              alt="Campaign Logo"
              height={80}
              width={200}
              className="h-8 max-w-[200px] object-contain object-left"
              priority
            />
          )}
        </div>
        <ul className="flex space-x-6 list-none">
          <li>
            <Link to="about"  smooth duration={500} className="hover:opacity-80 cursor-pointer">
              About
            </Link>
          </li>
          <li>
            <Link
              to="contact"
              smooth
              duration={500}
              className="hover:opacity-80 cursor-pointer"
            >
              Contact
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  )
}
