Even though we have a way to pass in blobs as artifacts, so far we have not created a way to pass in user inputs that are blobs. All user inputs have been basic value (string, integer etc). So there should be a way in the inputs.yaml to specify a blob (a file for image, video etc.). We can have the local path of the file to do that. So if an input is of a blob type (image, audio, video etc.) or an array of blob types, then in the inputs file we can
specify the local file paths for those and the input parser in core package handles loading and creating binary buffers and
passing along to the provider to upload to S3 compatible store.

inputs.yaml file:
```yaml
inputs:
  InquiryPrompt: "Who was Bismarck and what was his significance for Germany?"
  Duration: 20
  NumOfSegments: 2
  InputImages:
    - file: ./images/bismarck.jpg
    - file: ./images/berlin.jpg
  InputAudio: file: ./audio/bismarck.mp3
```
The f