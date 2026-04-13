import Anthropic from '@anthropic-ai/sdk';
import { log } from '../utils/logger';

const apiKey = process.env.ANTHROPIC_API_KEY;

if (apiKey) {
  log.event('Anthropic API key loaded');
} else {
  log.warn('ANTHROPIC_API_KEY not configured — AI features will be unavailable');
}

export const anthropic = new Anthropic({ apiKey: apiKey || 'placeholder' });
