import { exec as execNonPromise } from 'child_process';

export const exec = (command: string): Promise<string> => new Promise((resolve, reject) => {
  execNonPromise(command, (error, stdout, stderr) => {
    if (error) {
      return reject(error);
    }
    if (stderr) {
      return resolve(stderr);
    }

    return resolve(stdout);
  });
});
