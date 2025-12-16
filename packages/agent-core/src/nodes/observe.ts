/**
 * Observe Node
 * 
 * Captures the current state of the browser for the agent to reason about.
 * Implements:
 * - RA-01: Basic observation (URL, title, content)
 * - SA-01: Page load state detection
 * - SA-04: Intermediate state detection (loading, modals)
 * - SA-06: Page change detection
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { AgentState, Observation, PageLoadState } from '../state';
import { computeContentHash, hasPageChanged } from '../state';

/**
 * Detect loading indicators in page content (SA-04)
 */
function detectLoadingIndicator(content: string): boolean {
  const loadingPatterns = [
    /loading/i,
    /spinner/i,
    /please wait/i,
    /加载中/,
    /正在加载/,
    /class="[^"]*loading[^"]*"/i,
    /class="[^"]*spinner[^"]*"/i,
    /aria-busy="true"/i,
  ];
  
  return loadingPatterns.some(pattern => pattern.test(content));
}

/**
 * Detect modal overlays in page content (SA-04)
 */
function detectModalOverlay(content: string): boolean {
  const modalPatterns = [
    /class="[^"]*modal[^"]*"/i,
    /class="[^"]*overlay[^"]*"/i,
    /class="[^"]*dialog[^"]*"/i,
    /role="dialog"/i,
    /role="alertdialog"/i,
    /aria-modal="true"/i,
    /class="[^"]*popup[^"]*"/i,
  ];
  
  return modalPatterns.some(pattern => pattern.test(content));
}

/**
 * Get page load state from document.readyState (SA-01)
 * 
 * document.readyState values:
 * - 'loading': Document is loading
 * - 'interactive': DOM is ready, resources still loading
 * - 'complete': All resources loaded
 */
async function getPageLoadState(browserAdapter: IBrowserAdapter): Promise<PageLoadState> {
  try {
    const result = await browserAdapter.runCode('document.readyState');
    if (result.success && result.data) {
      const readyState = String(result.data);
      // Map document.readyState to our PageLoadState
      switch (readyState) {
        case 'loading':
          return 'loading';
        case 'interactive':
          return 'interactive';
        case 'complete':
          return 'complete';
        default:
          return 'complete';
      }
    }
  } catch {
    // If we can't get readyState, assume complete
  }
  return 'complete';
}

/**
 * Creates an observe node that captures browser state (RA-01, SA-*)
 */
export function createObserveNode(browserAdapter: IBrowserAdapter) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log('[ObserveNode] Capturing browser state (RA-01)...');
    
    try {
      // Check if browser is connected
      if (!browserAdapter.isConnected()) {
        console.log('[ObserveNode] Browser not connected, returning minimal observation');
        
        // Return a minimal observation that allows chat messages to be handled
        // The think node will detect this and handle accordingly
        const observation: Observation = {
          timestamp: new Date().toISOString(),
          url: 'browser://not-connected',
          title: '浏览器未连接',
          content: '浏览器尚未连接。请先连接到浏览器，或者你可以直接跟我聊天。',
          loadState: 'error',
          hasLoadingIndicator: false,
          hasModalOverlay: false,
          contentHash: 'not-connected',
          previousUrl: state.observation?.url,
        };
        
        return {
          status: 'observing',
          observation,
          previousObservation: state.observation,
          iterationCount: state.iterationCount + 1,
        };
      }

      // Get current page info
      const pageInfo = await browserAdapter.getPageInfo();
      
      // Get page content (simplified for context window)
      let content = '';
      try {
        const fullContent = await browserAdapter.getPageContent();
        // Truncate content to avoid context window issues
        content = fullContent.slice(0, 10000);
      } catch {
        content = 'Failed to get page content';
      }

      // SA-01: Get page load state from document.readyState
      const loadState = await getPageLoadState(browserAdapter);
      
      // SA-04: Detect intermediate states
      const hasLoadingIndicator = detectLoadingIndicator(content);
      const hasModalOverlay = detectModalOverlay(content);
      
      // SA-06: Compute content hash for change detection
      const contentHash = computeContentHash(content);
      const previousUrl = state.observation?.url;

      const observation: Observation = {
        timestamp: new Date().toISOString(),
        url: pageInfo.url,
        title: pageInfo.title,
        content,
        // SA-01: Page load state
        loadState,
        // SA-04: Intermediate states
        hasLoadingIndicator,
        hasModalOverlay,
        // SA-06: Change detection
        contentHash,
        previousUrl,
      };

      // SA-06: Check if page changed
      const pageChanged = hasPageChanged(observation, state.observation);
      
      console.log(`[ObserveNode] Observed: ${pageInfo.url} - ${pageInfo.title}`);
      console.log(`[ObserveNode] Load state: ${loadState}, Modal: ${hasModalOverlay}, Loading: ${hasLoadingIndicator}`);
      if (pageChanged) {
        console.log('[ObserveNode] SA-06: Page content changed');
      }

      return {
        status: 'observing',
        observation,
        // SA-06: Store previous observation for comparison
        previousObservation: state.observation,
        iterationCount: state.iterationCount + 1,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ObserveNode] Error:', errorMessage);
      
      return {
        status: 'error',
        error: `Observation failed: ${errorMessage}`,
        observation: null,
      };
    }
  };
}

