# Ollama Performance Investigation

## Issue
AI generation is taking a long time despite having an RTX 4090 GPU on 192.168.1.223.

## Changes Made

1. **Added Timeout Protection**: 
   - Task generation: 60 second timeout
   - Branch name generation: 30 second timeout
   - Prevents hanging indefinitely

2. **Added Performance Logging**:
   - Logs start time, completion time, and duration
   - Warns if generation takes >10s (task) or >5s (branch name)
   - Suggests checking GPU configuration if slow

3. **Improved Error Messages**:
   - Better error messages when timeouts occur
   - Guidance on checking GPU usage

## Root Cause Analysis

The most likely causes of slow generation:

1. **Ollama Not Using GPU**: 
   - Check if Ollama is configured to use CUDA/GPU
   - Run `nvidia-smi` on 192.168.1.223 during generation to see GPU utilization
   - If GPU utilization is 0%, Ollama is running on CPU (much slower)

2. **Model Not Loaded in GPU Memory**:
   - The model needs to be loaded into GPU VRAM first
   - First request after server restart will be slower
   - Check `size_vram` in Ollama API response

3. **Model Size/Quantization**:
   - Current model: mistral:latest (7.2B parameters, Q4_K_M quantization)
   - On RTX 4090 with GPU: Should generate ~100-130 tokens/second
   - On CPU: Much slower, could take 30-60+ seconds

## How to Verify GPU Usage

SSH to 192.168.1.223 and run:
```bash
# Check GPU utilization
nvidia-smi

# Check Ollama process
ps aux | grep ollama

# Check if CUDA is available to Ollama
ollama show mistral
```

## Recommendations

1. **Verify Ollama GPU Configuration**:
   - Ensure Ollama was installed with GPU support
   - Check environment variables: `CUDA_VISIBLE_DEVICES`, `OLLAMA_GPU_LAYERS`
   - Restart Ollama service if needed

2. **Monitor Performance**:
   - Check server logs for `[AI]` messages showing generation times
   - If consistently >10s, GPU is likely not being used

3. **Alternative Models**:
   - Consider using smaller/faster models for simple tasks
   - Or use fallback generation (already implemented) for faster response

4. **Optimize Prompts**:
   - Current prompts are already optimized for structured output
   - Consider reducing context if not needed

## Expected Performance

- **With GPU (RTX 4090)**: 2-5 seconds for task generation
- **Without GPU (CPU only)**: 30-60+ seconds for task generation

The timeout warnings in logs will indicate if GPU is not being used.

