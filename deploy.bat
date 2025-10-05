@echo off
echo Cleaning Hexo...
call hexo clean

echo Generating static files...
call hexo g

echo Deploying to Vercel...
cd public
call vercel --prod --yes --name bblog

cd ..

pause
