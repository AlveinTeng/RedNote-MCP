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
