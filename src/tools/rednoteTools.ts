import { AuthManager } from '../auth/authManager'
import { Browser, Page } from 'playwright'
import logger from '../utils/logger'
import { GetNoteDetail, NoteDetail } from './noteDetail'

export interface Note {
  title: string
  content: string
  tags: string[]
  url: string
  author: string
  likes?: number
  collects?: number
  comments?: number
}

export interface Comment {
  author: string
  content: string
  likes: number
  time: string
}

export class RedNoteTools {
  private authManager: AuthManager
  private browser: Browser | null = null
  private page: Page | null = null

  constructor() {
    logger.info('Initializing RedNoteTools')
    this.authManager = new AuthManager()
  }

  async initialize(): Promise<void> {
    logger.info('Initializing browser and page')
    this.browser = await this.authManager.getBrowser()
    if (!this.browser) {
      throw new Error('Failed to initialize browser')
    }
    
    try {
      this.page = await this.browser.newPage()
      
      // Load cookies if available
      const cookies = await this.authManager.getCookies()
      if (cookies.length > 0) {
        logger.info(`Loading ${cookies.length} cookies`)
        await this.page.context().addCookies(cookies)
      }

      // Check login status
      logger.info('Checking login status')
      await this.page.goto('https://www.xiaohongshu.com')
      const isLoggedIn = await this.page.evaluate(() => {
        const sidebarUser = document.querySelector('.user.side-bar-component .channel')
        return sidebarUser?.textContent?.trim() === '我'
      })

      // If not logged in, perform login
      if (!isLoggedIn) {
        logger.error('Not logged in, please login first')
        throw new Error('Not logged in')
      }
      logger.info('Login status verified')
    } catch (error) {
      // 初始化过程中出错，确保清理资源
      await this.cleanup()
      throw error
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser resources')
    try {
      if (this.page) {
        await this.page.close().catch(err => logger.error('Error closing page:', err))
        this.page = null
      }
      
      if (this.browser) {
        await this.browser.close().catch(err => logger.error('Error closing browser:', err))
        this.browser = null
      }
    } catch (error) {
      logger.error('Error during cleanup:', error)
    } finally {
      this.page = null
      this.browser = null
    }
  }

  extractRedBookUrl(shareText: string): string {
    // 匹配 http://xhslink.com/ 开头的链接
    const xhslinkRegex = /(https?:\/\/xhslink\.com\/[a-zA-Z0-9\/]+)/i
    const xhslinkMatch = shareText.match(xhslinkRegex)

    if (xhslinkMatch && xhslinkMatch[1]) {
      return xhslinkMatch[1]
    }

    // 匹配 https://www.xiaohongshu.com/ 开头的链接
    const xiaohongshuRegex = /(https?:\/\/(?:www\.)?xiaohongshu\.com\/[^，\s]+)/i
    const xiaohongshuMatch = shareText.match(xiaohongshuRegex)

    if (xiaohongshuMatch && xiaohongshuMatch[1]) {
      return xiaohongshuMatch[1]
    }

    return shareText
  }

  async searchNotes(keywords: string, limit: number = 10): Promise<Note[]> {
    logger.info(`Searching notes with keywords: ${keywords}, limit: ${limit}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Navigate to search page
      logger.info('Navigating to search page')
      await this.page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keywords)}`)

      // Wait for search results to load
      logger.info('Waiting for search results')
      await this.page.waitForSelector('.feeds-container', {
        timeout: 30000
      })

      // Get all note items
      let noteItems = await this.page.$$('.feeds-container .note-item')
      logger.info(`Found ${noteItems.length} note items`)
      const notes: Note[] = []

      // Process each note
      for (let i = 0; i < Math.min(noteItems.length, limit); i++) {
        logger.info(`Processing note ${i + 1}/${Math.min(noteItems.length, limit)}`)
        try {
          // Click on the note cover to open detail
          await noteItems[i].$eval('a.cover.mask.ld', (el: HTMLElement) => el.click())

          // Wait for the note page to load
          logger.info('Waiting for note page to load')
          await this.page.waitForSelector('#noteContainer', {
            timeout: 30000
          })

          await this.randomDelay(0.5, 1.5)

          // Extract note content
          const note = await this.page.evaluate(() => {
            const article = document.querySelector('#noteContainer')
            if (!article) return null

            // Get title
            const titleElement = article.querySelector('#detail-title')
            const title = titleElement?.textContent?.trim() || ''

            // Get content
            const contentElement = article.querySelector('#detail-desc .note-text')
            const content = contentElement?.textContent?.trim() || ''

            // Get author info
            const authorElement = article.querySelector('.author-wrapper .username')
            const author = authorElement?.textContent?.trim() || ''

            // Get interaction counts from engage-bar
            const engageBar = document.querySelector('.engage-bar-style')
            const likesElement = engageBar?.querySelector('.like-wrapper .count')
            const likes = parseInt(likesElement?.textContent?.replace(/[^\d]/g, '') || '0')

            const collectElement = engageBar?.querySelector('.collect-wrapper .count')
            const collects = parseInt(collectElement?.textContent?.replace(/[^\d]/g, '') || '0')

            const commentsElement = engageBar?.querySelector('.chat-wrapper .count')
            const comments = parseInt(commentsElement?.textContent?.replace(/[^\d]/g, '') || '0')

            return {
              title,
              content,
              url: window.location.href,
              author,
              likes,
              collects,
              comments
            }
          })

          if (note) {
            logger.info(`Extracted note: ${note.title}`)
            notes.push(note as Note)
          }

          // Add random delay before closing
          await this.randomDelay(0.5, 1)

          // Close note by clicking the close button
          const closeButton = await this.page.$('.close-circle')
          if (closeButton) {
            logger.info('Closing note dialog')
            await closeButton.click()

            // Wait for note dialog to disappear
            await this.page.waitForSelector('#noteContainer', {
              state: 'detached',
              timeout: 30000
            })
          }
        } catch (error) {
          logger.error(`Error processing note ${i + 1}:`, error)
          const closeButton = await this.page.$('.close-circle')
          if (closeButton) {
            logger.info('Attempting to close note dialog after error')
            await closeButton.click()

            // Wait for note dialog to disappear
            await this.page.waitForSelector('#noteContainer', {
              state: 'detached',
              timeout: 30000
            })
          }
        } finally {
          // Add random delay before next note
          await this.randomDelay(0.5, 1.5)
        }
      }

      logger.info(`Successfully processed ${notes.length} notes`)
      return notes
    } catch (error) {
      logger.error('Error searching notes:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async getNoteContent(url: string): Promise<NoteDetail> {
    logger.info(`Getting note content for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      const actualURL = this.extractRedBookUrl(url)
      await this.page.goto(actualURL)
      let note = await GetNoteDetail(this.page)
      note.url = url
      logger.info(`Successfully extracted note: ${note.title}`)
      return note
    } catch (error) {
      logger.error('Error getting note content:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async getNoteComments(url: string): Promise<Comment[]> {
    logger.info(`Getting comments for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      await this.page.goto(url)

      // Wait for comments to load
      logger.info('Waiting for comments to load')
      await this.page.waitForSelector('[role="dialog"] [role="list"]')

      // Extract comments
      const comments = await this.page.evaluate(() => {
        const items = document.querySelectorAll('[role="dialog"] [role="list"] [role="listitem"]')
        const results: Comment[] = []

        items.forEach((item) => {
          const author = item.querySelector('[data-testid="user-name"]')?.textContent?.trim() || ''
          const content = item.querySelector('[data-testid="comment-content"]')?.textContent?.trim() || ''
          const likes = parseInt(item.querySelector('[data-testid="likes-count"]')?.textContent || '0')
          const time = item.querySelector('time')?.textContent?.trim() || ''

          results.push({ author, content, likes, time })
        })

        return results
      })

      logger.info(`Successfully extracted ${comments.length} comments`)
      return comments
    } catch (error) {
      logger.error('Error getting note comments:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Search for posts by a specific user
   * @param username The username to search for
   * @param limit Maximum number of posts to retrieve
   * @returns Array of Note objects
   */
  async searchNotesByUser(username: string, limit: number = 10): Promise<Note[]> {
    logger.info(`Searching for posts by user: ${username}, limit: ${limit}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Search for posts by the specific user
      const searchQuery = `@${username}`
      logger.info(`Searching with query: ${searchQuery}`)
      await this.page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(searchQuery)}`)

      // Wait for search results to load
      logger.info('Waiting for search results')
      await this.page.waitForSelector('.feeds-container', {
        timeout: 30000
      })

      // Get all note items
      let noteItems = await this.page.$$('.feeds-container .note-item')
      logger.info(`Found ${noteItems.length} note items`)

      // Filter notes by the specific user
      const userNotes: Note[] = []
      for (let i = 0; i < noteItems.length && userNotes.length < limit; i++) {
        try {
          // Check if this note is by the target user
          const authorElement = await noteItems[i].$('.author-wrapper .username, .author .username, .user-name')
          if (authorElement) {
            const author = await authorElement.textContent()
            if (author?.trim() === username) {
              // Click on the note cover to open detail
              await noteItems[i].$eval('a.cover.mask.ld', (el: HTMLElement) => el.click())

              // Wait for the note page to load
              logger.info('Waiting for note page to load')
              await this.page.waitForSelector('#noteContainer', {
                timeout: 30000
              })

              await this.randomDelay(0.5, 1.5)

              // Extract note content
              const note = await this.page.evaluate(() => {
                const article = document.querySelector('#noteContainer')
                if (!article) return null

                // Get title
                const titleElement = article.querySelector('#detail-title')
                const title = titleElement?.textContent?.trim() || ''

                // Get content
                const contentElement = article.querySelector('#detail-desc .note-text')
                const content = contentElement?.textContent?.trim() || ''

                // Get author info
                const authorElement = article.querySelector('.author-wrapper .username')
                const author = authorElement?.textContent?.trim() || ''

                // Get interaction counts from engage-bar
                const engageBar = document.querySelector('.engage-bar-style')
                const likesElement = engageBar?.querySelector('.like-wrapper .count')
                const likes = parseInt(likesElement?.textContent?.replace(/[^\d]/g, '') || '0')

                const collectElement = engageBar?.querySelector('.collect-wrapper .count')
                const collects = parseInt(collectElement?.textContent?.replace(/[^\d]/g, '') || '0')

                const commentsElement = engageBar?.querySelector('.chat-wrapper .count')
                const comments = parseInt(commentsElement?.textContent?.replace(/[^\d]/g, '') || '0')

                return {
                  title,
                  content,
                  url: window.location.href,
                  author,
                  likes,
                  collects,
                  comments
                }
              })

              if (note) {
                logger.info(`Extracted note by ${username}: ${note.title}`)
                userNotes.push(note as Note)
              }

              // Add random delay before closing
              await this.randomDelay(0.5, 1)

              // Close note by clicking the close button
              const closeButton = await this.page.$('.close-circle')
              if (closeButton) {
                logger.info('Closing note dialog')
                await closeButton.click()

                // Wait for note dialog to disappear
                await this.page.waitForSelector('#noteContainer', {
                  state: 'detached',
                  timeout: 30000
                })
              }
            }
          }
        } catch (error) {
          logger.error(`Error processing note ${i + 1}:`, error)
          // Try to close any open dialogs
          const closeButton = await this.page.$('.close-circle')
          if (closeButton) {
            await closeButton.click()
            await this.page.waitForSelector('#noteContainer', {
              state: 'detached',
              timeout: 30000
            })
          }
        } finally {
          // Add random delay before next note
          await this.randomDelay(0.5, 1.5)
        }
      }

      logger.info(`Successfully processed ${userNotes.length} notes by user ${username}`)
      return userNotes
    } catch (error) {
      logger.error('Error searching notes by user:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Get the first post from a specific user profile (simplified approach)
   * @param profileUrl The user profile URL
   * @returns Note object or null if not found
   */
  async getFirstUserPost(profileUrl: string): Promise<Note | null> {
    logger.info(`Getting first post from user profile: ${profileUrl}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Navigate to user profile page
      logger.info('Navigating to user profile page')
      await this.page.goto(profileUrl)
      
      // Human-like delay after page load
      await this.randomDelay(2, 4)
      
      // Wait for page to load
      logger.info('Waiting for page to load')
      await this.page.waitForLoadState('networkidle', { timeout: 30000 })
      
      // Take a screenshot for debugging
      await this.page.screenshot({ path: 'profile-page.png' })
      logger.info('Screenshot saved as profile-page.png for debugging')
      
      // Try to find the first note link with multiple selector strategies
      logger.info('Looking for the first note link')
      const firstNoteUrl = await this.page.evaluate(() => {
        // Strategy 1: Look for note items with more comprehensive selectors
        const noteSelectors = [
          '.note-item a[href*="/explore/"]',
          '.user-notes a[href*="/explore/"]',
          'a[href*="/explore/"]',
          '.note a[href*="/explore/"]',
          '.post a[href*="/explore/"]',
          '[data-testid="note-item"] a[href*="/explore/"]',
          '.feed-item a[href*="/explore/"]',
          '.content-item a[href*="/explore/"]',
          '.item a[href*="/explore/"]'
        ]
        
        for (const selector of noteSelectors) {
          try {
            const element = document.querySelector(selector)
            if (element) {
              const href = element.getAttribute('href')
              if (href && href.includes('/explore/')) {
                return href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        // Strategy 2: Look for any link containing /explore/ with more specific targeting
        const allLinks = document.querySelectorAll('a[href*="/explore/"]')
        for (let i = 0; i < allLinks.length; i++) {
          const link = allLinks[i]
          const href = link.getAttribute('href')
          if (href && href.includes('/explore/')) {
            // Check if this link is likely a note (not navigation, not user profile, etc.)
            const linkText = link.textContent?.trim() || ''
            const parentText = link.parentElement?.textContent?.trim() || ''
            
            // Skip if it's just navigation or user info
            if (linkText.length > 3 && !linkText.includes('关注') && !linkText.includes('粉丝')) {
              return href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
            }
          }
        }
        
        // Strategy 3: Look for any clickable elements that might contain note content
        const clickableElements = document.querySelectorAll('a, [role="button"], .clickable')
        for (let i = 0; i < clickableElements.length; i++) {
          const element = clickableElements[i]
          const href = element.getAttribute('href')
          if (href && href.includes('/explore/')) {
            return href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
          }
        }
        
        return null
      })
      
      if (!firstNoteUrl) {
        logger.warn('No note URLs found in profile')
        
                 // Enhanced debugging: Get more information about what's on the page
         const pageInfo = await this.page.evaluate(() => {
           const info: {
             title: string
             allLinks: Array<{href: string | null, text: string, className: string}>
             possibleNoteElements: Array<{selector: string, count: number, firstElement: {className: string, textContent: string | undefined}}>
           } = {
             title: document.title,
             allLinks: Array.from(document.querySelectorAll('a')).map(a => ({
               href: a.getAttribute('href'),
               text: a.textContent?.trim() || '',
               className: a.className
             })).filter(a => a.href && a.href.includes('/explore/')),
             possibleNoteElements: []
           }
           
           // Look for elements that might contain note content
           const possibleSelectors = [
             '.note-item',
             '.post-item', 
             '.content-item',
             '.feed-item',
             '.item',
             '[data-testid*="note"]',
             '[data-testid*="post"]',
             '[data-testid*="content"]'
           ]
           
           possibleSelectors.forEach(selector => {
             const elements = document.querySelectorAll(selector)
             if (elements.length > 0) {
               info.possibleNoteElements.push({
                 selector,
                 count: elements.length,
                 firstElement: {
                   className: elements[0].className,
                   textContent: elements[0].textContent?.substring(0, 100)
                 }
               })
             }
           })
           
           return info
         })
        
        logger.info(`Page debugging info: ${JSON.stringify(pageInfo, null, 2)}`)
        return null
      }
      
      logger.info(`Found first note URL: ${firstNoteUrl}`)
      
      // Navigate to the first note
      logger.info('Navigating to first note')
      await this.page.goto(firstNoteUrl)
      
      // Human-like delay after navigation
      await this.randomDelay(2, 4)
      
      // Check if this is a mobile-only post (QR code page)
      const isMobileOnly = await this.page.evaluate(() => {
        // Look for indicators that this post is mobile-only
        const qrCodeSelectors = [
          '.qr-code',
          '.mobile-only',
          '.scan-qr',
          '[data-testid="qr-code"]',
          '.download-app'
        ]
        
        for (const selector of qrCodeSelectors) {
          if (document.querySelector(selector)) {
            return true
          }
        }
        
        // Check page content for mobile-only indicators
        const pageText = document.body.textContent || ''
        const mobileIndicators = [
          '请在手机端查看',
          '扫描二维码',
          '手机端查看',
          '移动端查看',
          '请在APP中查看',
          '请使用手机APP查看',
          '移动端专属',
          '手机端专属',
          '请在移动端查看'
        ]
        
        return mobileIndicators.some(indicator => pageText.includes(indicator))
      })
      
      if (isMobileOnly) {
        logger.warn('First post is mobile-only (requires QR code scan). Trying to find a desktop-accessible post...')
        
        // Go back to profile and try to find another post
        await this.page.goBack()
        await this.randomDelay(2, 4)
        
        // Try to find a different post that might be desktop-accessible
        const alternativeNoteUrl = await this.page.evaluate(() => {
          // Look for posts that might be more accessible
          const allLinks = document.querySelectorAll('a[href*="/explore/"]')
          const urls: string[] = []
          
          for (let i = 0; i < allLinks.length; i++) {
            const link = allLinks[i]
            const href = link.getAttribute('href')
            if (href && href.includes('/explore/')) {
              const linkText = link.textContent?.trim() || ''
              // Skip if it's just navigation or user info
              if (linkText.length > 3 && !linkText.includes('关注') && !linkText.includes('粉丝')) {
                urls.push(href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`)
              }
            }
          }
          
          // Try to find posts that are more likely to be desktop-accessible
          // Look for posts with longer titles (more likely to be full content)
          let bestUrl = urls[0] || null
          let bestScore = 0
          
          for (const url of urls) {
            const link = Array.from(allLinks).find(l => {
              const href = l.getAttribute('href')
              return href && (href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`) === url
            })
            
            if (link) {
              const linkText = link.textContent?.trim() || ''
              let score = linkText.length // Longer text = higher score
              
              // Bonus for posts that look like they have content
              if (linkText.includes('！') || linkText.includes('❤️') || linkText.includes('✌️')) {
                score += 10
              }
              
              if (score > bestScore) {
                bestScore = score
                bestUrl = url
              }
            }
          }
          
          return bestUrl
        })
        
        if (alternativeNoteUrl && alternativeNoteUrl !== firstNoteUrl) {
          logger.info(`Trying alternative post: ${alternativeNoteUrl}`)
          await this.page.goto(alternativeNoteUrl)
          await this.randomDelay(2, 4)
        } else {
          logger.warn('No alternative posts found. The user may only have mobile-only content.')
          return null
        }
      }
      
      // Wait for note content to load
      const noteContentSelectors = [
        '#noteContainer',
        '.note-content',
        '.post-content',
        '.content',
        '.note-detail'
      ]
      
      let noteContentFound = false
      for (const selector of noteContentSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 10000 })
          noteContentFound = true
          logger.info(`Found note content with selector: ${selector}`)
          break
        } catch (e) {
          logger.debug(`Selector ${selector} not found for note content`)
        }
      }
      
      if (!noteContentFound) {
        logger.warn('No note content container found')
        // Take screenshot for debugging
        await this.page.screenshot({ path: 'note-page.png' })
        logger.info('Screenshot saved as note-page.png for debugging')
        return null
      }
      
      // Simulate reading time
      await this.randomDelay(3, 5)
      
      // Extract note content
      const note = await this.page.evaluate(() => {
        // Try multiple selectors for different page layouts
        const contentSelectors = [
          '#noteContainer',
          '.note-content',
          '.post-content',
          '.content',
          '.note-detail'
        ]
        
        let article = null
        for (const selector of contentSelectors) {
          article = document.querySelector(selector)
          if (article) break
        }
        
        if (!article) return null

        // Get title with multiple selector options
        const titleSelectors = [
          '#detail-title',
          '.title',
          'h1',
          '.note-title',
          '.post-title'
        ]
        
        let title = ''
        for (const selector of titleSelectors) {
          const element = article.querySelector(selector)
          if (element?.textContent?.trim()) {
            title = element.textContent.trim()
            break
          }
        }

        // Get content with multiple selector options
        const contentTextSelectors = [
          '#detail-desc .note-text',
          '.content',
          '.text',
          '.note-text',
          '.post-text'
        ]
        
        let content = ''
        for (const selector of contentTextSelectors) {
          const element = article.querySelector(selector)
          if (element?.textContent?.trim()) {
            content = element.textContent.trim()
            break
          }
        }

        // Get author info with multiple selector options
        const authorSelectors = [
          '.author-wrapper .username',
          '.author',
          '.user-name',
          '.username'
        ]
        
        let author = ''
        for (const selector of authorSelectors) {
          const element = article.querySelector(selector)
          if (element?.textContent?.trim()) {
            author = element.textContent.trim()
            break
          }
        }

        // Get interaction counts with multiple selector options
        const engageBarSelectors = [
          '.engage-bar-style',
          '.interaction-bar',
          '.stats',
          '.metrics'
        ]
        
        let engageBar = null
        for (const selector of engageBarSelectors) {
          engageBar = document.querySelector(selector)
          if (engageBar) break
        }
        
        let likes = 0, collects = 0, comments = 0
        
        if (engageBar) {
          const likeSelectors = ['.like-wrapper .count', '.likes-count', '.like-count']
          const collectSelectors = ['.collect-wrapper .count', '.collects-count', '.collect-count']
          const commentSelectors = ['.chat-wrapper .count', '.comments-count', '.comment-count']
          
          for (const selector of likeSelectors) {
            const element = engageBar.querySelector(selector)
            if (element?.textContent) {
              likes = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
              break
            }
          }
          
          for (const selector of collectSelectors) {
            const element = engageBar.querySelector(selector)
            if (element?.textContent) {
              collects = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
              break
            }
          }
          
          for (const selector of commentSelectors) {
            const element = engageBar.querySelector(selector)
            if (element?.textContent) {
              comments = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
              break
            }
          }
        }

        return {
          title,
          content,
          url: window.location.href,
          author,
          likes,
          collects,
          comments
        }
      })

      if (note) {
        logger.info(`Successfully extracted first note: ${note.title}`)
        return note as Note
      } else {
        logger.warn('Failed to extract note content')
        return null
      }
      
    } catch (error) {
      logger.error('Error getting first user post:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Get all posts from a specific user profile
   * @param profileUrl The user profile URL
   * @param limit Maximum number of posts to retrieve (default: all available)
   * @returns Array of Note objects
   */
  async getUserPosts(profileUrl: string, limit?: number): Promise<Note[]> {
    logger.info(`Getting posts from user profile: ${profileUrl}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Navigate to user profile page
      logger.info('Navigating to user profile page')
      await this.page.goto(profileUrl)
      
      // Human-like delay after page load
      await this.randomDelay(2, 4)
      
      // Wait for page to load and check what selectors are available
      logger.info('Waiting for page to load')
      await this.page.waitForLoadState('networkidle', { timeout: 30000 })
      
      // Additional human-like delay
      await this.randomDelay(1, 3)
      
      // Debug: Check what elements are available on the page
      const availableSelectors = await this.page.evaluate(() => {
        const selectors = [
          '.user-profile',
          '.profile',
          '.user-info',
          '.user-notes',
          '.notes-container',
          '.feeds-container',
          '[data-testid="user-profile"]',
          '[data-testid="profile"]'
        ]
        
        const available = selectors.filter(selector => {
          try {
            return document.querySelector(selector) !== null
          } catch {
            return false
          }
        })
        
        return available
      })
      
      logger.info(`Available selectors: ${availableSelectors.join(', ')}`)
      
      // Try to find a suitable container for the profile content
      let profileContainer = null
      for (const selector of availableSelectors) {
        try {
          profileContainer = await this.page.$(selector)
          if (profileContainer) {
            logger.info(`Found profile container with selector: ${selector}`)
            break
          }
        } catch (e) {
          logger.debug(`Selector ${selector} not found`)
        }
      }
      
      if (!profileContainer) {
        // If no specific profile container found, try to find any content area
        logger.info('No specific profile container found, looking for general content area')
        await this.page.waitForSelector('body', { timeout: 10000 })
      }

      // Human-like scrolling behavior - scroll down gradually like a real person
      logger.info('Scrolling to load all posts with human-like behavior')
      let previousHeight = 0
      let scrollAttempts = 0
      const maxScrollAttempts = 15 // Increased for more realistic behavior
      let totalScrollDistance = 0

      while (scrollAttempts < maxScrollAttempts) {
        // Get current page height
        previousHeight = await this.page.evaluate('document.body.scrollHeight')
        
        // Scroll in smaller, more realistic increments
        const scrollIncrement = Math.floor(Math.random() * 300) + 200 // Random scroll between 200-500px
        totalScrollDistance += scrollIncrement
        
        await this.page.evaluate((increment) => {
          window.scrollBy(0, increment)
        }, scrollIncrement)
        
        // Human-like delay between scrolls (varies based on scroll distance)
        const scrollDelay = Math.min(scrollIncrement / 100, 3) + Math.random() * 2
        await this.randomDelay(scrollDelay, scrollDelay + 1)
        
        // Sometimes scroll back up a little (like a real person)
        if (Math.random() < 0.3) {
          const backScroll = Math.floor(Math.random() * 100) + 50
          await this.page.evaluate((backScroll) => {
            window.scrollBy(0, -backScroll)
          }, backScroll)
          await this.randomDelay(0.5, 1.5)
        }
        
        // Check if we've reached the bottom
        const newHeight = await this.page.evaluate('document.body.scrollHeight')
        if (newHeight === previousHeight) {
          scrollAttempts++
          // Add extra delay when we think we're at the bottom
          await this.randomDelay(2, 4)
        } else {
          scrollAttempts = 0
          // Reset scroll attempts when new content loads
          await this.randomDelay(1, 2)
        }
        
        // Random pause to simulate reading content
        if (Math.random() < 0.4) {
          logger.debug('Taking a break to read content (human-like behavior)')
          await this.randomDelay(3, 6)
        }
      }

      // Final delay after scrolling
      await this.randomDelay(2, 4)

      // Extract all note URLs from the profile with more flexible selectors
      logger.info('Extracting note URLs from profile')
      const noteUrls = await this.page.evaluate(() => {
        // Try multiple selector patterns for note links
        const selectors = [
          '.note-item a',
          '.user-notes a[href*="/explore/"]',
          'a[href*="/explore/"]',
          '.note a',
          '.post a',
          '[data-testid="note-item"] a',
          '.feed-item a'
        ]
        
        const urls: string[] = []
        
        selectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector)
            elements.forEach((element) => {
              const href = element.getAttribute('href')
              if (href && href.includes('/explore/')) {
                const fullUrl = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
                urls.push(fullUrl)
              }
            })
          } catch (e) {
            // Skip invalid selectors
          }
        })
        
        return [...new Set(urls)] // Remove duplicates
      })

      logger.info(`Found ${noteUrls.length} note URLs in profile`)
      
      if (noteUrls.length === 0) {
        logger.warn('No note URLs found in profile')
        // Debug: Take a screenshot to see what the page looks like
        await this.page.screenshot({ path: 'profile-debug.png' })
        logger.info('Screenshot saved as profile-debug.png for debugging')
        return []
      }

      // Apply limit if specified
      const urlsToProcess = limit ? noteUrls.slice(0, limit) : noteUrls
      logger.info(`Processing ${urlsToProcess.length} notes`)

      const notes: Note[] = []
      
      // Process each note URL with human-like behavior
      for (let i = 0; i < urlsToProcess.length; i++) {
        const noteUrl = urlsToProcess[i]
        logger.info(`Processing note ${i + 1}/${urlsToProcess.length}: ${noteUrl}`)
        
        try {
          // Navigate to the note page
          await this.page.goto(noteUrl)
          
          // Human-like delay after navigation
          await this.randomDelay(2, 4)
          
          // Wait for note content to load with multiple selector options
          const noteContentSelectors = [
            '#noteContainer',
            '.note-content',
            '.post-content',
            '.content',
            '.note-detail'
          ]
          
          let noteContentFound = false
          for (const selector of noteContentSelectors) {
            try {
              await this.page.waitForSelector(selector, { timeout: 10000 })
              noteContentFound = true
              logger.info(`Found note content with selector: ${selector}`)
              break
            } catch (e) {
              logger.debug(`Selector ${selector} not found for note content`)
            }
          }
          
          if (!noteContentFound) {
            logger.warn('No note content container found, skipping this note')
            continue
          }
          
          // Simulate reading time - longer for longer content
          const readingDelay = Math.min(5, Math.max(2, Math.random() * 8))
          logger.debug(`Simulating reading time: ${readingDelay.toFixed(1)} seconds`)
          await this.randomDelay(readingDelay, readingDelay + 2)
          
          // Sometimes scroll within the note (human-like behavior)
          if (Math.random() < 0.6) {
            const scrollAmount = Math.floor(Math.random() * 200) + 100
            await this.page.evaluate((amount) => {
              window.scrollBy(0, amount)
            }, scrollAmount)
            await this.randomDelay(1, 3)
          }
          
          // Extract note content with flexible selectors
          const note = await this.page.evaluate(() => {
            // Try multiple selectors for different page layouts
            const contentSelectors = [
              '#noteContainer',
              '.note-content',
              '.post-content',
              '.content',
              '.note-detail'
            ]
            
            let article = null
            for (const selector of contentSelectors) {
              article = document.querySelector(selector)
              if (article) break
            }
            
            if (!article) return null

            // Get title with multiple selector options
            const titleSelectors = [
              '#detail-title',
              '.title',
              'h1',
              '.note-title',
              '.post-title'
            ]
            
            let title = ''
            for (const selector of titleSelectors) {
              const element = article.querySelector(selector)
              if (element?.textContent?.trim()) {
                title = element.textContent.trim()
                break
              }
            }

            // Get content with multiple selector options
            const contentTextSelectors = [
              '#detail-desc .note-text',
              '.content',
              '.text',
              '.note-text',
              '.post-text'
            ]
            
            let content = ''
            for (const selector of contentTextSelectors) {
              const element = article.querySelector(selector)
              if (element?.textContent?.trim()) {
                content = element.textContent.trim()
                break
              }
            }

            // Get author info with multiple selector options
            const authorSelectors = [
              '.author-wrapper .username',
              '.author',
              '.user-name',
              '.username'
            ]
            
            let author = ''
            for (const selector of authorSelectors) {
              const element = article.querySelector(selector)
              if (element?.textContent?.trim()) {
                author = element.textContent.trim()
                break
              }
            }

            // Get interaction counts with multiple selector options
            const engageBarSelectors = [
              '.engage-bar-style',
              '.interaction-bar',
              '.stats',
              '.metrics'
            ]
            
            let engageBar = null
            for (const selector of engageBarSelectors) {
              engageBar = document.querySelector(selector)
              if (engageBar) break
            }
            
            let likes = 0, collects = 0, comments = 0
            
            if (engageBar) {
              const likeSelectors = ['.like-wrapper .count', '.likes-count', '.like-count']
              const collectSelectors = ['.collect-wrapper .count', '.collects-count', '.collect-count']
              const commentSelectors = ['.chat-wrapper .count', '.comments-count', '.comment-count']
              
              for (const selector of likeSelectors) {
                const element = engageBar.querySelector(selector)
                if (element?.textContent) {
                  likes = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
                  break
                }
              }
              
              for (const selector of collectSelectors) {
                const element = engageBar.querySelector(selector)
                if (element?.textContent) {
                  collects = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
                  break
                }
              }
              
              for (const selector of commentSelectors) {
                const element = engageBar.querySelector(selector)
                if (element?.textContent) {
                  comments = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
                  break
                }
              }
            }

            return {
              title,
              content,
              url: window.location.href,
              author,
              likes,
              collects,
              comments
            }
          })

          if (note) {
            logger.info(`Extracted note: ${note.title}`)
            notes.push(note as Note)
          }

          // Human-like delay before next note - varies based on content length
          const contentLength = note?.content?.length || 0
          const baseDelay = Math.min(8, Math.max(3, contentLength / 100))
          const randomDelay = baseDelay + Math.random() * 4
          
          logger.debug(`Waiting ${randomDelay.toFixed(1)} seconds before next note (human-like behavior)`)
          await this.randomDelay(randomDelay, randomDelay + 2)
          
          // Random longer break every few notes (like a real person)
          if (i > 0 && i % 3 === 0) {
            const breakTime = Math.floor(Math.random() * 10) + 5
            logger.debug(`Taking a longer break: ${breakTime} seconds (human-like behavior)`)
            await this.randomDelay(breakTime, breakTime + 5)
          }
          
        } catch (error) {
          logger.error(`Error processing note ${i + 1}:`, error)
          // Continue with next note
          await this.randomDelay(2, 4) // Still wait a bit even on error
        }
      }

      logger.info(`Successfully processed ${notes.length} notes from user profile`)
      return notes
      
    } catch (error) {
      logger.error('Error getting user posts:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Advanced method to get all posts from a user using multiple strategies
   * @param profileUrl The user profile URL
   * @param limit Maximum number of posts to retrieve (default: all available)
   * @returns Array of Note objects
   */
  async getAllUserPostsAdvanced(profileUrl: string, limit?: number): Promise<Note[]> {
    logger.info(`Advanced method: Getting all posts from user profile: ${profileUrl}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      // Strategy 1: Try to extract user ID and search by username
      const userInfo = await this.extractUserInfoFromProfile(profileUrl)
      if (userInfo) {
        logger.info(`Extracted user info: ${JSON.stringify(userInfo)}`)
        
        // Try multiple search strategies
        const posts = await this.tryMultipleSearchStrategies(userInfo, limit)
        if (posts.length > 0) {
          logger.info(`Successfully found ${posts.length} posts using search strategies`)
          return posts
        }
      }

      // Strategy 2: Enhanced profile scraping with better selectors
      logger.info('Falling back to enhanced profile scraping')
      return await this.enhancedProfileScraping(profileUrl, limit)
      
    } catch (error) {
      logger.error('Error in advanced user posts method:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Extract user information from profile page
   */
  private async extractUserInfoFromProfile(profileUrl: string): Promise<{username?: string, userId?: string, displayName?: string} | null> {
    try {
      await this.page!.goto(profileUrl)
      await this.randomDelay(3, 6)
      
      // Take screenshot for debugging
      await this.page!.screenshot({ path: 'user-profile-debug.png' })
      
      const userInfo = await this.page!.evaluate(() => {
        // Try to extract username from various selectors
        const usernameSelectors = [
          '.username',
          '.user-name',
          '.profile-name',
          'h1',
          '.title',
          '[data-testid="username"]',
          '[data-testid="user-name"]'
        ]
        
        let username = ''
        for (const selector of usernameSelectors) {
          const element = document.querySelector(selector)
          if (element?.textContent?.trim()) {
            username = element.textContent.trim()
            break
          }
        }
        
        // Try to extract user ID from URL or page elements
        const userIdMatch = window.location.pathname.match(/\/user\/profile\/([^/?]+)/)
        const userId = userIdMatch ? userIdMatch[1] : ''
        
        // Try to get display name from profile
        const displayNameSelectors = [
          '.display-name',
          '.nickname',
          '.real-name',
          '.profile-title'
        ]
        
        let displayName = ''
        for (const selector of displayNameSelectors) {
          const element = document.querySelector(selector)
          if (element?.textContent?.trim()) {
            displayName = element.textContent.trim()
            break
          }
        }
        
        return { username, userId, displayName }
      })
      
      logger.info(`Extracted user info: ${JSON.stringify(userInfo)}`)
      return userInfo
      
    } catch (error) {
      logger.error('Error extracting user info:', error)
      return null
    }
  }

  /**
   * Try multiple search strategies to find user posts
   */
  private async tryMultipleSearchStrategies(userInfo: {username?: string, userId?: string, displayName?: string}, limit?: number): Promise<Note[]> {
    const strategies = [
      // Strategy 1: Search by username with @ symbol
      async () => {
        if (userInfo.username) {
          logger.info(`Trying search strategy 1: @${userInfo.username}`)
          return await this.searchNotesByUser(userInfo.username, limit || 20)
        }
        return []
      },
      
      // Strategy 2: Search by display name
      async () => {
        if (userInfo.displayName && userInfo.displayName !== userInfo.username) {
          logger.info(`Trying search strategy 2: "${userInfo.displayName}"`)
          return await this.searchNotesByUser(userInfo.displayName, limit || 20)
        }
        return []
      },
      
      // Strategy 3: Search by user ID (if it looks like a username)
      async () => {
        if (userInfo.userId && userInfo.userId.length < 20 && !userInfo.userId.includes('000000')) {
          logger.info(`Trying search strategy 3: "${userInfo.userId}"`)
          return await this.searchNotesByUser(userInfo.userId, limit || 20)
        }
        return []
      },
      
      // Strategy 4: Search for posts that mention the user
      async () => {
        if (userInfo.username || userInfo.displayName) {
          const searchTerm = (userInfo.username || userInfo.displayName)!
          logger.info(`Trying search strategy 4: posts mentioning "${searchTerm}"`)
          return await this.searchNotes(searchTerm, limit || 20)
        }
        return []
      }
    ]
    
    for (let i = 0; i < strategies.length; i++) {
      try {
        logger.info(`Executing search strategy ${i + 1}`)
        const posts = await strategies[i]()
        if (posts.length > 0) {
          logger.info(`Strategy ${i + 1} successful: found ${posts.length} posts`)
          return posts
        }
      } catch (error) {
        logger.warn(`Strategy ${i + 1} failed:`, error)
        continue
      }
    }
    
    logger.warn('All search strategies failed')
    return []
  }

  /**
   * Enhanced profile scraping with better anti-detection
   */
  private async enhancedProfileScraping(profileUrl: string, limit?: number): Promise<Note[]> {
    try {
      await this.page!.goto(profileUrl)
      
      // Advanced anti-detection: Random delays and human-like behavior
      await this.advancedAntiDetection()
      
      // Try to find posts using multiple approaches
      const posts = await this.findPostsInProfile(limit)
      
      if (posts.length === 0) {
        // Try alternative approach: Look for any content that might be posts
        logger.info('Trying alternative content extraction approach')
        return await this.extractAlternativeContent(limit)
      }
      
      return posts
      
    } catch (error) {
      logger.error('Error in enhanced profile scraping:', error)
      return []
    }
  }

  /**
   * Advanced anti-detection measures
   */
  private async advancedAntiDetection(): Promise<void> {
    logger.info('Applying advanced anti-detection measures')
    
    // Random initial delay
    await this.randomDelay(5, 10)
    
    // Simulate human-like page interaction
    await this.simulateHumanPageInteraction()
    
    // Random mouse movements
    await this.simulateHumanMouseMovement()
    
    // Random scrolling behavior
    await this.simulateHumanScrolling()
    
    // Sometimes wait longer (like reading)
    if (Math.random() < 0.7) {
      const readingTime = Math.floor(Math.random() * 15) + 10
      logger.debug(`Simulating reading time: ${readingTime} seconds`)
      await this.randomDelay(readingTime, readingTime + 5)
    }
  }

  /**
   * Simulate human-like page interaction
   */
  private async simulateHumanPageInteraction(): Promise<void> {
    try {
      // Sometimes click on random elements (like a real user exploring)
      if (Math.random() < 0.3) {
        const clickableElements = await this.page!.$$('button, a, [role="button"]')
        if (clickableElements.length > 0) {
          const randomElement = clickableElements[Math.floor(Math.random() * clickableElements.length)]
          await randomElement.hover()
          await this.randomDelay(0.5, 2)
          // Don't actually click to avoid navigation issues
        }
      }
      
      // Sometimes scroll to random positions
      if (Math.random() < 0.4) {
        const scrollY = Math.floor(Math.random() * 1000) + 100
        await this.page!.evaluate((y) => window.scrollTo(0, y), scrollY)
        await this.randomDelay(1, 3)
      }
      
    } catch (error) {
      logger.debug('Page interaction simulation failed, continuing...')
    }
  }

  /**
   * Find posts in profile using multiple detection methods
   */
  private async findPostsInProfile(limit?: number): Promise<Note[]> {
    logger.info('Searching for posts in profile using multiple detection methods')
    
    // Method 1: Look for post containers
    const postContainers = await this.page!.evaluate(() => {
      const containers = []
      const selectors = [
        '.note-item',
        '.post-item',
        '.content-item',
        '.feed-item',
        '.item',
        '[data-testid*="note"]',
        '[data-testid*="post"]',
        '[data-testid*="content"]'
      ]
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          containers.push({
            selector,
            count: elements.length,
            elements: Array.from(elements).map(el => ({
              text: el.textContent?.trim().substring(0, 200),
              className: el.className,
              tagName: el.tagName
            }))
          })
        }
      }
      
      return containers
    })
    
    logger.info(`Found ${postContainers.length} potential post containers`)
    
    // Method 2: Look for any text that looks like post content
    const postTexts = await this.page!.evaluate(() => {
      const texts = []
      const allElements = document.querySelectorAll('*')
      
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i]
        const text = element.textContent?.trim()
        
        if (text && text.length > 20 && text.length < 500) {
          // Check if it looks like a post title/content
          if (text.includes('！') || text.includes('❤️') || text.includes('✌️') || 
              text.includes('？') || text.includes('。') || text.includes('，')) {
            texts.push({
              text: text.substring(0, 200),
              tagName: element.tagName,
              className: element.className
            })
          }
        }
      }
      
      return texts.slice(0, 50) // Limit to first 50
    })
    
    logger.info(`Found ${postTexts.length} potential post texts`)
    
    // Method 3: Look for any links that might lead to posts
    const postLinks = await this.page!.evaluate(() => {
      const links = []
      const allLinks = document.querySelectorAll('a')
      
      for (let i = 0; i < allLinks.length; i++) {
        const link = allLinks[i]
        const href = link.getAttribute('href')
        const text = link.textContent?.trim()
        
        if (href && text && text.length > 3) {
          // Check if it might be a post link
          if (href.includes('/explore/') || href.includes('/note/') || 
              href.includes('/post/') || href.includes('/content/')) {
            links.push({
              href,
              text: text.substring(0, 100),
              fullUrl: href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`
            })
          }
        }
      }
      
      return links
    })
    
    logger.info(`Found ${postLinks.length} potential post links`)
    
    // Combine all findings and try to extract actual posts
    const allFindings = { postContainers, postTexts, postLinks }
    logger.info(`Combined findings: ${JSON.stringify(allFindings, null, 2)}`)
    
    // Try to extract posts from the findings
    return await this.extractPostsFromFindings(allFindings, limit)
  }

  /**
   * Extract posts from profile findings
   */
  private async extractPostsFromFindings(findings: any, limit?: number): Promise<Note[]> {
    const posts: Note[] = []
    
    // Try to extract posts from links first
    if (findings.postLinks && findings.postLinks.length > 0) {
      logger.info(`Attempting to extract posts from ${findings.postLinks.length} links`)
      
      const linksToProcess = limit ? findings.postLinks.slice(0, limit) : findings.postLinks
      
      for (let i = 0; i < linksToProcess.length; i++) {
        try {
          const link = linksToProcess[i]
          logger.info(`Processing link ${i + 1}/${linksToProcess.length}: ${link.text}`)
          
          // Navigate to the post
          await this.page!.goto(link.fullUrl)
          await this.randomDelay(3, 6)
          
          // Check if this is accessible content
          const isAccessible = await this.checkContentAccessibility()
          if (isAccessible) {
            const post = await this.extractPostContent()
            if (post) {
              posts.push(post)
              logger.info(`Successfully extracted post: ${post.title}`)
            }
          } else {
            logger.warn(`Post not accessible (likely mobile-only): ${link.text}`)
          }
          
          // Human-like delay between posts
          await this.randomDelay(5, 10)
          
        } catch (error) {
          logger.error(`Error processing link ${i + 1}:`, error)
          continue
        }
      }
    }
    
    // If no posts found from links, try to create posts from text content
    if (posts.length === 0 && findings.postTexts && findings.postTexts.length > 0) {
      logger.info('No posts extracted from links, creating posts from text content')
      
      const textsToProcess = limit ? findings.postTexts.slice(0, limit) : findings.postTexts
      
      for (let i = 0; i < textsToProcess.length; i++) {
        const text = textsToProcess[i]
        if (text.text && text.text.length > 10) {
          posts.push({
            title: text.text.substring(0, 50) + (text.text.length > 50 ? '...' : ''),
            content: text.text,
            url: this.page!.url(),
            author: 'Unknown', // We can't determine author from text alone
            tags: [],
            likes: 0,
            collects: 0,
            comments: 0
          })
        }
      }
    }
    
    return posts
  }

  /**
   * Check if content is accessible (not mobile-only)
   */
  private async checkContentAccessibility(): Promise<boolean> {
    return await this.page!.evaluate(() => {
      // Check for mobile-only indicators
      const mobileIndicators = [
        '.qr-code',
        '.mobile-only',
        '.scan-qr',
        '[data-testid="qr-code"]',
        '.download-app'
      ]
      
      for (const selector of mobileIndicators) {
        if (document.querySelector(selector)) {
          return false
        }
      }
      
      // Check page content for mobile-only text
      const pageText = document.body.textContent || ''
      const mobileTexts = [
        '请在手机端查看',
        '扫描二维码',
        '手机端查看',
        '移动端查看',
        '请在APP中查看'
      ]
      
      return !mobileTexts.some(text => pageText.includes(text))
    })
  }

  /**
   * Extract post content using multiple selectors
   */
  private async extractPostContent(): Promise<Note | null> {
    return await this.page!.evaluate(() => {
      // Try multiple selectors for content
      const contentSelectors = [
        '#noteContainer',
        '.note-content',
        '.post-content',
        '.content',
        '.note-detail',
        'article',
        '.post',
        '.note'
      ]
      
      let contentElement = null
      for (const selector of contentSelectors) {
        contentElement = document.querySelector(selector)
        if (contentElement) break
      }
      
      if (!contentElement) return null
      
      // Extract title
      const titleSelectors = [
        '#detail-title',
        '.title',
        'h1',
        '.note-title',
        '.post-title'
      ]
      
      let title = ''
      for (const selector of titleSelectors) {
        const element = contentElement.querySelector(selector)
        if (element?.textContent?.trim()) {
          title = element.textContent.trim()
          break
        }
      }
      
      // Extract content
      const contentTextSelectors = [
        '#detail-desc .note-text',
        '.content',
        '.text',
        '.note-text',
        '.post-text'
      ]
      
      let content = ''
      for (const selector of contentTextSelectors) {
        const element = contentElement.querySelector(selector)
        if (element?.textContent?.trim()) {
          content = element.textContent.trim()
          break
        }
      }
      
      // Extract author
      const authorSelectors = [
        '.author-wrapper .username',
        '.author',
        '.user-name',
        '.username'
      ]
      
      let author = ''
      for (const selector of authorSelectors) {
        const element = contentElement.querySelector(selector)
        if (element?.textContent?.trim()) {
          author = element.textContent.trim()
          break
        }
      }
      
      // Extract interaction counts
      const engageBarSelectors = [
        '.engage-bar-style',
        '.interaction-bar',
        '.stats',
        '.metrics'
      ]
      
      let engageBar = null
      for (const selector of engageBarSelectors) {
        engageBar = document.querySelector(selector)
        if (engageBar) break
      }
      
      let likes = 0, collects = 0, comments = 0
      
      if (engageBar) {
        const likeSelectors = ['.like-wrapper .count', '.likes-count', '.like-count']
        const collectSelectors = ['.collect-wrapper .count', '.collects-count', '.collect-count']
        const commentSelectors = ['.chat-wrapper .count', '.comments-count', '.comment-count']
        
        for (const selector of likeSelectors) {
          const element = engageBar.querySelector(selector)
          if (element?.textContent) {
            likes = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
            break
          }
        }
        
        for (const selector of collectSelectors) {
          const element = engageBar.querySelector(selector)
          if (element?.textContent) {
            collects = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
            break
          }
        }
        
        for (const selector of commentSelectors) {
          const element = engageBar.querySelector(selector)
          if (element?.textContent) {
            comments = parseInt(element.textContent.replace(/[^\d]/g, '') || '0')
            break
          }
        }
      }
      
      return {
        title,
        content,
        url: window.location.href,
        author,
        likes,
        collects,
        comments,
        tags: []
      }
    })
  }

  /**
   * Extract alternative content when direct post extraction fails
   */
  private async extractAlternativeContent(limit?: number): Promise<Note[]> {
    logger.info('Extracting alternative content from profile')
    
    const alternativePosts = await this.page!.evaluate(() => {
      const posts = []
      
      // Look for any text content that might be posts
      const allElements = document.querySelectorAll('*')
      
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i]
        const text = element.textContent?.trim()
        
        if (text && text.length > 30 && text.length < 1000) {
          // Check if it looks like meaningful content
          if (text.includes('。') || text.includes('！') || text.includes('？') || 
              text.includes('，') || text.includes('：') || text.includes('；')) {
            
            // Skip if it's just navigation or UI text
            if (!text.includes('关注') && !text.includes('粉丝') && 
                !text.includes('登录') && !text.includes('注册') &&
                !text.includes('首页') && !text.includes('搜索')) {
              
              posts.push({
                title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                content: text,
                url: window.location.href,
                author: 'Unknown',
                tags: [],
                likes: 0,
                collects: 0,
                comments: 0
              })
            }
          }
        }
      }
      
      return posts.slice(0, limit || 20)
    })
    
    logger.info(`Extracted ${alternativePosts.length} alternative posts`)
    return alternativePosts
  }

  /**
   * Wait for a random duration between min and max seconds
   * @param min Minimum seconds to wait
   * @param max Maximum seconds to wait
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    logger.debug(`Adding random delay of ${delay.toFixed(2)} seconds`)
    await new Promise((resolve) => setTimeout(resolve, delay * 1000))
  }

  /**
   * Simulate human-like mouse movement
   */
  private async simulateHumanMouseMovement(): Promise<void> {
    if (!this.page) return
    
    try {
      // Random mouse movement to simulate human behavior
      const viewport = this.page.viewportSize()
      if (viewport) {
        const x = Math.floor(Math.random() * viewport.width)
        const y = Math.floor(Math.random() * viewport.height)
        
        // Move mouse to random position
        await this.page.mouse.move(x, y)
        await this.randomDelay(0.1, 0.5)
      }
    } catch (error) {
      // Ignore mouse movement errors
      logger.debug('Mouse movement simulation failed, continuing...')
    }
  }

  /**
   * Simulate human-like scrolling behavior
   */
  private async simulateHumanScrolling(): Promise<void> {
    if (!this.page) return
    
    try {
      // Get current scroll position
      const currentScroll = await this.page.evaluate(() => window.pageYOffset)
      
      // Scroll in a natural way
      const scrollAmount = Math.floor(Math.random() * 300) + 100
      await this.page.evaluate((amount) => {
        window.scrollBy({
          top: amount,
          behavior: 'smooth'
        })
      }, scrollAmount)
      
      // Wait for scroll to complete
      await this.randomDelay(0.5, 1.5)
      
      // Sometimes scroll back up a little (like reading)
      if (Math.random() < 0.4) {
        const backScroll = Math.floor(Math.random() * 100) + 50
        await this.page.evaluate((amount) => {
          window.scrollBy({
            top: -amount,
            behavior: 'smooth'
          })
        }, backScroll)
        await this.randomDelay(0.3, 1.0)
      }
    } catch (error) {
      logger.debug('Scroll simulation failed, continuing...')
    }
  }
}
