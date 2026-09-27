// macOS-only descriptor-relative operations. Never traverse a symlink or overwrite.
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <copyfile.h>
#include <CommonCrypto/CommonDigest.h>

_Noreturn static void fail(const char *reason) { fprintf(stderr, "%s (errno %d)\n", reason, errno); exit(1); }
static int enforceRepo=0;
static int directory(int base, const char *part, int create) {
  if (!*part || !strcmp(part,".") || !strcmp(part,"..")) fail("Unsafe path component");
  if (create && mkdirat(base, part, 0700) && errno != EEXIST) fail("Cannot create directory");
  int fd = openat(base, part, O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(fd < 0) fail("Directory unavailable or symlink");
  return fd;
}
static void no_repository(int fd) {
  struct stat marker;
  const char *names[]={".git",".hg",".svn"};
  for(int i=0;i<3;i++) {
    if(fstatat(fd,names[i],&marker,AT_SYMLINK_NOFOLLOW)==0) fail("Repository protected");
    if(errno!=ENOENT) fail("Cannot verify repository protection");
  }
}
static int parent(int base, const char *relative, char *leaf, int create) {
  if (!*relative || *relative=='/' || strlen(relative)>=PATH_MAX) fail("Invalid relative path");
  char path[PATH_MAX]; strcpy(path, relative);
  int fd=dup(base);if(fd<0)fail("Cannot duplicate root descriptor"); char *save=NULL, *part=strtok_r(path,"/",&save);
  if (!part) fail("Missing leaf");
  for (;;) {
    if(enforceRepo) no_repository(fd);
    char *next=strtok_r(NULL,"/",&save);
    if (!strcmp(part,".") || !strcmp(part,"..")) fail("Unsafe component");
    if(!next) { strcpy(leaf,part); return fd; }
    int d=directory(fd,part,create); close(fd); fd=d; part=next;
  }
}
static int rootfd(const char *root) {
  if(root[0]!='/' || !root[1]) fail("Root must be a specific absolute directory");
  int fd=open("/",O_RDONLY|O_DIRECTORY);if(fd<0)fail("Cannot open filesystem root"); char path[PATH_MAX];
  if(strlen(root)>=PATH_MAX) fail("Root too long"); strcpy(path,root+1);
  char *save=NULL;
  for(char *part=strtok_r(path,"/",&save);part;part=strtok_r(NULL,"/",&save)) {
    int next=directory(fd,part,0); close(fd); fd=next;
  }
  return fd;
}
static void digest(int fd, char *hex) {
  CC_SHA256_CTX context; CC_SHA256_Init(&context); unsigned char buf[131072], result[32]; ssize_t n;
  if(lseek(fd,0,SEEK_SET)<0) fail("Cannot seek");
  while((n=read(fd,buf,sizeof(buf)))>0) CC_SHA256_Update(&context,buf,(CC_LONG)n);
  if(n<0) fail("Cannot read"); CC_SHA256_Final(result,&context);
  for(int i=0;i<32;i++) sprintf(hex+i*2,"%02x",result[i]);
}
static void statfile(int fd,struct stat *s) {
  if(fstat(fd,s) || !S_ISREG(s->st_mode)) fail("Not regular file");
  // UF_COMPRESSED is fine; SF_DATALESS must not trigger cloud hydration.
  if(s->st_flags & 0x40000000) fail("Cloud placeholder protected");
}
static int same(struct stat *a,struct stat *b) {
 return a->st_dev==b->st_dev && a->st_ino==b->st_ino && a->st_size==b->st_size &&
 a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec;
}
int main(int argc,char **argv) {
  if(argc!=6 && argc!=12) fail("Invalid arguments");
  const char *mode=argv[1]; enforceRepo=!strcmp(mode,"move")||!strcmp(mode,"copy"); int root=rootfd(argv[2]); char name[PATH_MAX];
  struct stat rootstat;
  if(fstat(root,&rootstat) || (unsigned long long)rootstat.st_dev!=strtoull(argv[argc-2],NULL,10) ||
     (unsigned long long)rootstat.st_ino!=strtoull(argv[argc-1],NULL,10)) fail("Root identity changed");
  if(enforceRepo) {
    int ancestor=dup(root);if(ancestor<0)fail("Cannot duplicate root for ancestry check");
    for(;;) {
      no_repository(ancestor);struct stat a,b;if(fstat(ancestor,&a))fail("Cannot inspect ancestor");
      int up=openat(ancestor,"..",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(up<0)fail("Cannot verify ancestry");if(fstat(up,&b))fail("Cannot inspect parent ancestor");
      close(ancestor);ancestor=up;if(a.st_dev==b.st_dev&&a.st_ino==b.st_ino)break;
    }
    close(ancestor);
  }
  int p=parent(root,argv[3],name,0);
  struct stat preflight;
  if(fstatat(p,name,&preflight,AT_SYMLINK_NOFOLLOW) || !S_ISREG(preflight.st_mode) || (preflight.st_flags & 0x40000000)) fail("Protected or unavailable source");
  if(enforceRepo)no_repository(p);
  int fd=openat(p,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
  if(fd<0) fail("Source unavailable"); struct stat before,after; statfile(fd,&before);
  if(!strcmp(mode,"text")) {
    if(before.st_size>262144)fail("Text extraction size limit");
    char text[262144];ssize_t size=read(fd,text,sizeof(text));if(size<0||size!=before.st_size)fail("Text read incomplete");
    statfile(fd,&after);if(!same(&before,&after)||memchr(text,0,(size_t)size))fail("Changed or binary text");
    if(fwrite(text,1,(size_t)size,stdout)!=(size_t)size)fail("Text output failed");return 0;
  }
  char hash[65]; digest(fd,hash); statfile(fd,&after);
  if(!same(&before,&after)) fail("Source changed during hash");
  if(!strcmp(mode,"inspect")) {
    printf("{\"dev\":\"%llu\",\"ino\":\"%llu\",\"size\":%lld,\"mtime\":\"%lld:%ld\",\"hash\":\"%s\",\"links\":%u,\"allocated\":%lld}\n",
      (unsigned long long)before.st_dev,(unsigned long long)before.st_ino,(long long)before.st_size,
      (long long)before.st_mtimespec.tv_sec,before.st_mtimespec.tv_nsec,hash,before.st_nlink,(long long)before.st_blocks*512);
    return 0;
  }
  if(argc!=12 || (strcmp(mode,"move") && strcmp(mode,"copy"))) fail("Invalid operation");
  char stamp[80]; snprintf(stamp,sizeof(stamp),"%lld:%ld",(long long)before.st_mtimespec.tv_sec,before.st_mtimespec.tv_nsec);
  if((unsigned long long)before.st_dev!=strtoull(argv[5],NULL,10) ||
     (unsigned long long)before.st_ino!=strtoull(argv[6],NULL,10) ||
     before.st_size!=strtoll(argv[7],NULL,10) || strcmp(stamp,argv[8]) || strcmp(hash,argv[9])) fail("Stale plan");
  char dest[PATH_MAX]; int q=parent(root,argv[4],dest,1); struct stat entry;
  if(fstatat(p,name,&entry,AT_SYMLINK_NOFOLLOW) || !same(&entry,&before)) fail("Source replaced");
  if(!strcmp(mode,"move")) {
    if(renameatx_np(p,name,q,dest,RENAME_EXCL)) fail("Move refused (collision or cross-volume)");
    // Preserve the moved file if postcondition fails; never unlink an unexpected file.
    int moved=openat(q,dest,O_RDONLY|O_NOFOLLOW|O_NONBLOCK); struct stat ms;
    if(moved<0) fail("Moved file requires recovery"); statfile(moved,&ms); char mh[65]; digest(moved,mh);
    if(!same(&ms,&before) || strcmp(hash,mh)) {
      if(renameatx_np(q,dest,p,name,RENAME_EXCL)) fail("Changed file retained at destination; recovery required");
      fail("Source changed; move rolled back");
    }
    if(fsync(p)||fsync(q))fail("Move sync failed; recovery required");close(moved);
  } else {
    char temporary[PATH_MAX];if(snprintf(temporary,sizeof(temporary),"%s.jev-part",dest)>=(int)sizeof(temporary))fail("Destination too long");
    int out=openat(q,temporary,O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW,0600);
    if(out<0) fail("Copy destination exists or unavailable");
    if(lseek(fd,0,SEEK_SET)<0 || fcopyfile(fd,out,NULL,COPYFILE_ALL)) fail("Partial .jev-part copy retained; original safe; recovery required");
    if(fsync(out)) fail("Copy sync failed; .jev-part retained");
    char ch[65];digest(out,ch);
    statfile(fd,&after);
    if(strcmp(ch,hash) || !same(&before,&after)) fail("Copy verification failed; original and .jev-part retained");
    struct stat created,linked;statfile(out,&created);
    if(fstatat(q,temporary,&linked,AT_SYMLINK_NOFOLLOW)||!same(&created,&linked))fail("Copy temp replaced; no publication");
    if(renameatx_np(q,temporary,q,dest,RENAME_EXCL))fail("Copy publication refused; original and .jev-part retained");
    if(fsync(q))fail("Copy directory sync failed; recovery required");close(out);
  }
  puts("{\"ok\":true}"); close(fd); close(p); close(q); close(root); return 0;
}
