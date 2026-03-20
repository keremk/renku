# Frequently Asked Questions

Q: Is Renku open source?
A: The core, providers and compositions packages are MIT licensed. The other packages (mainly around the web site branding, CLI, the UI and the desktop app) are source available. 

Q: Is Renku free?
A: Renku itself is free. Using Renku requires signing up with some AI providers of your choice to generate videos. Calling model providers will incur charges according to their pricing. You enroll with them and provide the API keys you obtain from them.

Q: Can I use Renku on Windows?
A: Yes, but you need to (enable WSL2)[https://learn.microsoft.com/en-us/windows/wsl/install], and run Renku CLI inside a linux shell. 

Q: Why do I need Renku? 
A: Today, generating a great video longer than 10-20 seconds requires smaller clips and lots of iterations. It also requires you to provide images, raw audio and other configurations to provide consistency across those clips. And you need well-crafted prompts that are different per different AI model. Renku allows you to create an orchestration pipeline, and track dependencies between the artifacts generated. This ensures that you only regenerate the artifacts needed as you iterate on your video saving you costs. It helps you generate proper prompts, character/object images -- anything you need in your asset pipeline. And finally it stitches them together in a timeline with multiple tracks of video, narrative audio, music etc. with subtitles. A perfect companion for your social media posts! See (docs)[https://gorenku.com/docs/] for more info.

Q: Can I use other tools like DaVinci, Capcut etc. along with Renku?
A: Yes absolutely. Renku saves the media assets it generates in a folder that you can share with those tools.

Q: Does Renku produce AI slop?
A: Renku is not a generative AI model. It helps you pick and use the best models for your use case and iterate on their results. Using Renku enables you to create great looking videos as you iterate with these models. 

Q: Can I use Renku for long-form videos?
A: Renku UI is currently best tuned for videos around 6-20 segments, i.e. for videos of length less than 5 minutes. But this is not a hard limit of course, so you can try longer videos and help us evolve the UI by identifying shortcomings.

Q: Do I need to deal with YAML to produce new blueprints (templates)?
A: YAML is the internal representation format. You will most likely not need to hand code it from scratch, as we also created [Skills for your AI tools](https://gorenku.com/docs/app-using-skills/) (Claude, Codex, ... ) which does a great job of generating the YAML for your use case. 