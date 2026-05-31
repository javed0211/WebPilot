import axios from 'axios';
import * as dotenv from 'dotenv';
import { ConfigManager } from './ConfigManager';
import { UsageTracker } from '../utils/UsageTracker';
import { estimateCostUsd } from '../utils/ModelPricing';

dotenv.config();

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
  modelUsed: string;
}

export class LLMClient {
  private provider: string = 'google';
  private model: string = 'gemini-2.5-flash';
  private temperature: number = 0.0;
  private maxTokens: number = 4000;
  private fallbackModels: string[] = [];
  private retryAttempts: number = 3;
  private retryDelayMs: number = 1000;

  private loadLLMConfig(): any {
    try {
      const fs = require('fs');
      const path = require('path');
      const llmConfigPath = path.join(process.cwd(), 'config', 'llm.json');
      if (fs.existsSync(llmConfigPath)) {
        return JSON.parse(fs.readFileSync(llmConfigPath, 'utf8'));
      }
    } catch {
      // Ignore read faults
    }
    return {};
  }

  constructor(config?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    fallbackModels?: string[];
    retryAttempts?: number;
    retryDelayMs?: number;
  }) {
    // 1. Resolve active provider from unified ConfigManager
    const configManager = ConfigManager.getInstance();
    this.provider = configManager.get('framework.activeProvider', 'google');
    
    // 2. Resolve provider model and configurations from separate config/llm.json
    const llmConfig = this.loadLLMConfig();
    const activeProviderConfig = llmConfig[this.provider] || {};
    this.model = activeProviderConfig.model || 'gemini-2.5-flash';

    // 3. Apply constructor manual overrides if explicitly supplied
    if (config?.provider) this.provider = config.provider;
    if (config?.model) this.model = config.model;
    if (config?.temperature !== undefined) this.temperature = config.temperature;
    if (config?.maxTokens !== undefined) this.maxTokens = config.maxTokens;
    if (config?.fallbackModels !== undefined) this.fallbackModels = config.fallbackModels;
    if (config?.retryAttempts !== undefined) this.retryAttempts = config.retryAttempts;
    if (config?.retryDelayMs !== undefined) this.retryDelayMs = config.retryDelayMs;
  }

  /**
   * Estimates tokens for a given text. Used for tracking when API doesn't return it
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Resolves API keys dynamically. Supports environment variables AND inline raw keys inside config/llm.json
   */
  private resolveKeyForProvider(provider: string): string {
    const llmConfig = this.loadLLMConfig();
    const provConfig = llmConfig[provider] || {};

    // Check if the user specified an explicit inline raw key directly in llm.json
    if (provConfig.apiKey && provConfig.apiKey.trim() !== '' && !provConfig.apiKey.includes('YOUR_')) {
      // Auto-configure auxiliary options for cloud endpoints
      if (provider === 'azure') {
        if (provConfig.endpoint && String(provConfig.endpoint).trim()) {
          process.env.AZURE_OPENAI_ENDPOINT = provConfig.endpoint;
        }
        if (provConfig.apiVersion && String(provConfig.apiVersion).trim()) {
          process.env.AZURE_OPENAI_API_VERSION = provConfig.apiVersion;
        }
        if (provConfig.deploymentId && String(provConfig.deploymentId).trim()) {
          process.env.AZURE_OPENAI_DEPLOYMENT = provConfig.deploymentId;
        }
      } else if (provider === 'aws') {
        process.env.AWS_ACCESS_KEY_ID = provConfig.apiKey;
        if (provConfig.secretKey) process.env.AWS_SECRET_ACCESS_KEY = provConfig.secretKey;
        if (provConfig.region) process.env.AWS_BEDROCK_REGION = provConfig.region;
      } else if (provider === 'gcp') {
        if (provConfig.projectId) process.env.GCP_PROJECT_ID = provConfig.projectId;
        if (provConfig.region) process.env.GCP_LOCATION = provConfig.region;
      } else if (provider === 'ollama') {
        if (provConfig.endpoint) process.env.OLLAMA_ENDPOINT = provConfig.endpoint;
      }
      return provConfig.apiKey;
    }

    // Secondary Check for AWS Secret Key if apiKey was set from env
    if (provider === 'aws' && provConfig.secretKey && !provConfig.secretKey.includes('YOUR_')) {
      process.env.AWS_SECRET_ACCESS_KEY = provConfig.secretKey;
    }

    // 2. Fallback to standard system environment variables
    let envVar = 'GEMINI_API_KEY';
    if (provider === 'openai') envVar = 'OPENAI_API_KEY';
    else if (provider === 'anthropic') envVar = 'ANTHROPIC_API_KEY';
    else if (provider === 'azure') envVar = 'AZURE_OPENAI_API_KEY';
    else if (provider === 'gcp') envVar = 'GCP_API_KEY';

    if (process.env[envVar]) {
      return process.env[envVar]!;
    }

    // 3. Fallback for GCP OAuth access token mapping
    if (provider === 'gcp' && process.env.GCP_ACCESS_TOKEN) {
      return '';
    }

    throw new Error(`[LLM Key Resolver] Failed to resolve API key for provider "${provider}". Please add it as "apiKey" directly inside the "${provider}" block in config/llm.json, or export ${envVar} to your environment.`);
  }

  private resolveUsage(
    model: string,
    messages: LLMMessage[],
    outputText: string,
    promptFromApi?: number,
    completionFromApi?: number
  ): LLMResponse['usage'] {
    const promptTokens =
      promptFromApi && promptFromApi > 0
        ? promptFromApi
        : this.estimateTokens(messages.map((m) => m.content).join('\n'));
    const completionTokens =
      completionFromApi && completionFromApi > 0
        ? completionFromApi
        : this.estimateTokens(outputText);

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: estimateCostUsd(model, promptTokens, completionTokens)
    };
  }

  /**
   * Core generation request with retry mechanism
   */
  public async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    let currentProvider = this.provider;
    let currentModel = this.model;
    let modelsToTry = [currentModel, ...this.fallbackModels];

    for (const modelAttempt of modelsToTry) {
      currentModel = modelAttempt;
      currentProvider = modelAttempt === this.model ? this.provider : this.detectProvider(currentModel);

      let lastError: any = null;
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          const result = await this.executeRequest(currentProvider, currentModel, messages);
          UsageTracker.record(result.usage);
          return result;
        } catch (error: any) {
          lastError = error;
          console.warn(`[LLM Warning] Attempt ${attempt}/${this.retryAttempts} failed for model ${currentModel}: ${error.message}`);
          if (attempt < this.retryAttempts) {
            await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * Math.pow(2, attempt - 1)));
          }
        }
      }

      console.error(`[LLM Error] Model ${currentModel} failed all attempts. Trying next fallback...`);
    }

    throw new Error(`LLM Execution failed across all models and retries. Last error: ${currentModel}`);
  }

  private detectProvider(model: string): string {
    const m = model.toLowerCase();
    if (m.startsWith('gpt-')) return 'openai';
    if (m.startsWith('claude-')) return 'anthropic';
    if (m.startsWith('gemini-')) return 'google';
    if (m.startsWith('azure/')) return 'azure';
    if (m.startsWith('aws/')) return 'aws';
    if (m.startsWith('gcp/')) return 'gcp';
    if (m.includes('local') || m.includes('llama') || m.includes('mistral')) return 'ollama';
    return this.provider;
  }

  private async executeRequest(provider: string, model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    switch (provider.toLowerCase()) {
      case 'google':
        return await this.callGemini(model, messages);
      case 'openai':
        return await this.callOpenAI(model, messages);
      case 'anthropic':
        return await this.callAnthropic(model, messages);
      case 'azure':
        return await this.callAzureOpenAI(model, messages);
      case 'aws':
        return await this.callAWSBedrock(model, messages);
      case 'gcp':
        return await this.callGCPVertex(model, messages);
      case 'ollama':
        return await this.callOllama(model, messages);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  private async callGemini(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const apiKey = this.resolveKeyForProvider('google');

    // Google Gemini content structure
    // Combine system instructions and normal contents
    const systemMessage = messages.find(m => m.role === 'system');
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload: any = {
      contents,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens
      }
    };

    if (systemMessage) {
      payload.systemInstruction = {
        parts: [{ text: systemMessage.content }]
      };
    }

    const response = await axios.post(url, payload, { timeout: 30000 });
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.usageMetadata?.promptTokenCount,
      response.data.usageMetadata?.candidatesTokenCount
    );

    return { text, usage, modelUsed: model };
  }

  private async callOpenAI(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const apiKey = this.resolveKeyForProvider('openai');

    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await axios.post(
      url,
      {
        model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const text = response.data.choices?.[0]?.message?.content || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.usage?.prompt_tokens,
      response.data.usage?.completion_tokens
    );

    return { text, usage, modelUsed: model };
  }

  private async callAnthropic(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const apiKey = this.resolveKeyForProvider('anthropic');

    const systemMessage = messages.find(m => m.role === 'system');
    const system = systemMessage ? systemMessage.content : undefined;
    const anthropicMessages = messages.filter(m => m.role !== 'system');

    const url = 'https://api.anthropic.com/v1/messages';
    const response = await axios.post(
      url,
      {
        model,
        messages: anthropicMessages,
        system,
        max_tokens: this.maxTokens,
        temperature: this.temperature
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const text = response.data.content?.[0]?.text || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.usage?.input_tokens,
      response.data.usage?.output_tokens
    );

    return { text, usage, modelUsed: model };
  }

  private async callAzureOpenAI(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const apiKey = this.resolveKeyForProvider('azure');
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT; // e.g. https://my-resource.openai.azure.com
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || model.replace('azure/', '');
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2023-05-15';

    if (!apiKey || !endpoint) {
      throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be defined for Azure OpenAI.');
    }

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const response = await axios.post(
      url,
      {
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const text = response.data.choices?.[0]?.message?.content || '';
    const pricingModel = process.env.AZURE_OPENAI_DEPLOYMENT || model;
    const usage = this.resolveUsage(
      pricingModel,
      messages,
      text,
      response.data.usage?.prompt_tokens,
      response.data.usage?.completion_tokens
    );

    return { text, usage, modelUsed: pricingModel };
  }

  private async callAWSBedrock(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    const modelId = model.replace('aws/', '');

    const endpoint = process.env.AWS_BEDROCK_ENDPOINT || `https://bedrock-runtime.${region}.amazonaws.com`;
    const url = `${endpoint}/model/${modelId}/converse`;

    const systemMessage = messages.find(m => m.role === 'system');
    const system = systemMessage ? [{ text: systemMessage.content }] : [];

    const converseMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content }]
      }));

    if (!accessKey || !secretKey) {
      if (!process.env.AWS_BEDROCK_ENDPOINT) {
        throw new Error('AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) are required for AWS Bedrock.');
      }
    }

    const response = await axios.post(
      url,
      {
        system,
        messages: converseMessages,
        inferenceConfig: {
          temperature: this.temperature,
          maxTokens: this.maxTokens
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-amz-security-token': process.env.AWS_SESSION_TOKEN || ''
        },
        timeout: 30000
      }
    );

    const text = response.data.output?.message?.content?.[0]?.text || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.usage?.inputTokens,
      response.data.usage?.outputTokens
    );

    return { text, usage, modelUsed: model };
  }

  private async callGCPVertex(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const region = process.env.GCP_LOCATION || 'us-central1';
    const projectId = process.env.GCP_PROJECT_ID;
    let apiKey: string | undefined = undefined;
    try {
      apiKey = this.resolveKeyForProvider('gcp');
    } catch {
      // allow fallback to OAuth token
    }
    const modelId = model.replace('gcp/', '');

    if (!projectId && !apiKey) {
      throw new Error('GCP_PROJECT_ID or GCP_API_KEY is required for GCP Vertex AI.');
    }

    const url = apiKey 
      ? `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:generateContent?key=${apiKey}`
      : `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:generateContent`;

    const systemMessage = messages.find(m => m.role === 'system');
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const payload: any = {
      contents,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens
      }
    };

    if (systemMessage) {
      payload.systemInstruction = {
        parts: [{ text: systemMessage.content }]
      };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!apiKey && process.env.GCP_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GCP_ACCESS_TOKEN}`;
    }

    const response = await axios.post(url, payload, { headers, timeout: 30000 });
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.usageMetadata?.promptTokenCount,
      response.data.usageMetadata?.candidatesTokenCount
    );

    return { text, usage, modelUsed: model };
  }

  private async callOllama(model: string, messages: LLMMessage[]): Promise<LLMResponse> {
    const endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    const url = `${endpoint}/api/chat`;
    const response = await axios.post(
      url,
      {
        model,
        messages,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens
        },
        stream: false
      },
      { timeout: 30000 }
    );

    const text = response.data.message?.content || '';
    const usage = this.resolveUsage(
      model,
      messages,
      text,
      response.data.prompt_eval_count,
      response.data.eval_count
    );
    usage.cost = 0;

    return { text, usage, modelUsed: model };
  }
}
