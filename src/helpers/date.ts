import type { Bucket } from '@aws-sdk/client-s3';

export const dateString = (): string => {
  const date = new Date();
  const year = new Intl.DateTimeFormat('en', {
    year: 'numeric',
  })
    .format(date);
  const month = new Intl.DateTimeFormat('en', {
    month: '2-digit',
  })
    .format(date);
  const day = new Intl.DateTimeFormat('en', {
    day: '2-digit',
  })
    .format(date);
  const hours = new Intl.DateTimeFormat('de', {
    timeStyle: 'short',
  })
    .format(date);

  return `${year}${month}${day}-${hours.replace(':', '')}`;
};

export const sortBucketsNewestFirst = (buckets: (Bucket | undefined)[]): (Bucket | undefined)[] => {
  const sorted = buckets.sort((a, b) => {
    const bTime = b?.CreationDate?.getTime();
    const aTime = a?.CreationDate?.getTime();

    if (aTime && bTime) {
      return bTime - aTime;
    }

    return -1;
  });

  return sorted;

};
